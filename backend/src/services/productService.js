const AppError = require("../errors/AppError");
const productRepository = require("../data/repositories/productRepository");
const auditLogService = require("./auditLogService");
const { assertRoleAllowed, normalizeRole, recordDeniedAction } = require("./accessControlService");
const {
  validateProductPayload,
  validateRestockPayload,
} = require("../validation/productValidators");
const { assertCondition } = require("../validation/helpers");

const INVENTORY_CLERK_RESTRICTED_PRODUCT_FIELDS = [
  "name",
  "sku",
  "barcode",
  "imageUrl",
  "price",
  "unitCost",
  "taxClass",
];

function hasOwn(objectValue, key) {
  return Object.prototype.hasOwnProperty.call(objectValue || {}, key);
}

function normalizeComparableProductField(key, value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (["price", "unitCost", "stock"].includes(key)) {
    return Number(value);
  }

  return String(value).trim();
}

function getRestrictedProductFieldChanges(existing, payload = {}) {
  return INVENTORY_CLERK_RESTRICTED_PRODUCT_FIELDS.filter((field) => {
    if (!hasOwn(payload, field)) {
      return false;
    }

    return (
      normalizeComparableProductField(field, payload[field]) !==
      normalizeComparableProductField(field, existing?.[field])
    );
  });
}

async function getProducts() {
  return productRepository.getProducts();
}

async function getProductById(id) {
  const product = await productRepository.getProductById(id);

  if (!product) {
    throw new AppError(404, "Product not found.", {
      code: "PRODUCT_NOT_FOUND",
    });
  }

  return product;
}

async function getRecentInventoryMovements(limit = 8) {
  const normalizedLimit = Number(limit);
  return productRepository.getRecentInventoryMovements(
    Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 8
  );
}

async function getProductMovements(id, limit = 12) {
  const product = await getProductById(id);
  const normalizedLimit = Number(limit);

  return productRepository.getProductMovements(
    product.id,
    Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 12
  );
}

async function createProduct(payload, actor) {
  await assertRoleAllowed({
    actor,
    allowedRoles: ["Owner", "Manager"],
    action: "product.create",
    entityType: "product",
    entityId: "pending:new",
    message: "Only owners and managers can create catalog products.",
    code: "PRODUCT_CREATE_ROLE_REQUIRED",
  });

  const nextId = await productRepository.getNextProductId();
  const product = validateProductPayload({
    ...(payload || {}),
    id: nextId,
  });

  assertCondition(
    !(await productRepository.findProductByName(product.name)),
    "A product with this name already exists."
  );
  assertCondition(
    !(await productRepository.findProductBySku(product.sku)),
    "A product with this SKU already exists."
  );

  if (product.barcode) {
    assertCondition(
      !(await productRepository.findProductByBarcode(product.barcode)),
      "A product with this barcode already exists."
    );
  }

  const createdProduct = await productRepository.createProduct({
    id: nextId,
    ...product,
  });

  if (Number(createdProduct.stock || 0) > 0) {
    await productRepository.recordInventoryMovement({
      productId: createdProduct.id,
      movementType: "create",
      quantityDelta: Number(createdProduct.stock || 0),
      quantityBefore: 0,
      quantityAfter: Number(createdProduct.stock || 0),
      referenceType: "product",
      referenceId: String(createdProduct.id),
      note: "New inventory line created.",
      actorName: String(actor?.fullName || actor?.staffId || "System").trim(),
    });
  }

  await auditLogService.recordAuditEvent({
    actor,
    action: "product.created",
    entityType: "product",
    entityId: String(createdProduct.id),
    details: {
      sku: createdProduct.sku,
      stock: createdProduct.stock,
      category: createdProduct.category,
    },
  });

  return createdProduct;
}

async function updateProduct(id, payload, actor) {
  const existing = await getProductById(id);
  await assertRoleAllowed({
    actor,
    allowedRoles: ["Owner", "Manager", "Inventory Clerk"],
    action: "product.update",
    entityType: "product",
    entityId: String(existing.id),
    message: "Only operations staff can update products.",
    code: "PRODUCT_UPDATE_ROLE_REQUIRED",
  });

  const actorRole = normalizeRole(actor);
  const restrictedFieldChanges =
    actorRole === "Inventory Clerk" ? getRestrictedProductFieldChanges(existing, payload) : [];

  if (restrictedFieldChanges.length > 0) {
    await recordDeniedAction({
      actor,
      action: "product.update",
      entityType: "product",
      entityId: String(existing.id),
      reason:
        "Inventory clerks cannot change catalog identity or commercial pricing fields.",
      details: {
        restrictedFields: restrictedFieldChanges,
      },
    });

    throw new AppError(
      403,
      "Inventory clerks can adjust operational stock fields, but catalog identity and pricing changes require manager or owner approval.",
      {
        code: "PRODUCT_COMMERCIAL_FIELDS_RESTRICTED",
      }
    );
  }

  const hasTaxClassPatch = Object.prototype.hasOwnProperty.call(payload || {}, "taxClass");
  const product = validateProductPayload({
    name: payload?.name ?? existing.name,
    sku: payload?.sku ?? existing.sku,
    barcode: payload?.barcode ?? existing.barcode,
    imageUrl: payload?.imageUrl ?? existing.imageUrl,
    price: payload?.price ?? existing.price,
    unitCost: payload?.unitCost ?? existing.unitCost,
    stock: payload?.stock ?? existing.stock,
    unitLabel: payload?.unitLabel ?? existing.unitLabel,
    casePack: payload?.casePack ?? existing.casePack,
    reorderPoint: payload?.reorderPoint ?? existing.reorderPoint,
    parLevel: payload?.parLevel ?? existing.parLevel,
    shelfLocation: payload?.shelfLocation ?? existing.shelfLocation,
    receivingNotes: payload?.receivingNotes ?? existing.receivingNotes,
    category: payload?.category ?? existing.category,
    supplier: payload?.supplier ?? existing.supplier,
    ...(hasTaxClassPatch ? { taxClass: payload?.taxClass } : {}),
  });

  assertCondition(
    !(await productRepository.findProductByName(product.name, existing.id)),
    "A product with this name already exists."
  );
  assertCondition(
    !(await productRepository.findProductBySku(product.sku, existing.id)),
    "A product with this SKU already exists."
  );

  if (product.barcode) {
    assertCondition(
      !(await productRepository.findProductByBarcode(product.barcode, existing.id)),
      "A product with this barcode already exists."
    );
  }

  const updatedProduct = await productRepository.updateProduct(existing.id, {
    ...existing,
    ...product,
    ...(hasTaxClassPatch ? { taxClass: product.taxClass } : { taxClass: existing.taxClassOverride }),
  });

  const previousStock = Number(existing.stock || 0);
  const nextStock = Number(updatedProduct.stock || 0);

  if (previousStock !== nextStock) {
    await productRepository.recordInventoryMovement({
      productId: updatedProduct.id,
      movementType: "adjustment",
      quantityDelta: nextStock - previousStock,
      quantityBefore: previousStock,
      quantityAfter: nextStock,
      referenceType: "product",
      referenceId: String(updatedProduct.id),
      note: "Stock level adjusted from inventory management.",
      actorName: String(actor?.fullName || actor?.staffId || "System").trim(),
    });
  }

  await auditLogService.recordAuditEvent({
    actor,
    action: "product.updated",
    entityType: "product",
    entityId: String(updatedProduct.id),
    details: {
      previousStock,
      nextStock,
      sku: updatedProduct.sku,
    },
  });

  return updatedProduct;
}

async function deleteProduct(id, actor) {
  const existing = await getProductById(id);
  await assertRoleAllowed({
    actor,
    allowedRoles: ["Owner", "Manager"],
    action: "product.delete",
    entityType: "product",
    entityId: String(existing.id),
    message: "Only owners and managers can delete catalog products.",
    code: "PRODUCT_DELETE_ROLE_REQUIRED",
  });

  try {
    const deleted = await productRepository.deleteProduct(id);

    await auditLogService.recordAuditEvent({
      actor,
      action: "product.deleted",
      entityType: "product",
      entityId: String(deleted.id),
      details: {
        sku: deleted.sku,
        stock: deleted.stock,
      },
    });

    return deleted;
  } catch (error) {
    throw new AppError(
      409,
      "This product cannot be deleted because it is referenced by existing business records.",
      {
        code: "PRODUCT_DELETE_CONFLICT",
      }
    );
  }
}

async function restockProduct(id, payload, actor) {
  const existing = await getProductById(id);
  await assertRoleAllowed({
    actor,
    allowedRoles: ["Owner", "Manager", "Inventory Clerk"],
    action: "inventory.restock",
    entityType: "product",
    entityId: String(existing.id),
    message: "Only operations staff can restock inventory.",
    code: "PRODUCT_RESTOCK_ROLE_REQUIRED",
  });
  const { amount, note } = validateRestockPayload(payload);
  const restockedProduct = await productRepository.restockProductWithMovement(existing.id, amount, {
    movementType: "restock",
    referenceType: "product",
    referenceId: String(existing.id),
    note: note || "Manual restock recorded.",
    actorName: String(actor?.fullName || actor?.staffId || "System").trim(),
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "inventory.restocked",
    entityType: "product",
    entityId: String(restockedProduct.id),
    details: {
      amount,
      previousStock: existing.stock,
      nextStock: restockedProduct.stock,
      note,
    },
  });

  return restockedProduct;
}

module.exports = {
  getProducts,
  getProductById,
  getRecentInventoryMovements,
  getProductMovements,
  createProduct,
  updateProduct,
  deleteProduct,
  restockProduct,
};
