const AppError = require("../errors/AppError");
const supplierRepository = require("../data/repositories/supplierRepository");
const auditLogService = require("./auditLogService");
const { assertRoleAllowed, normalizeRole, recordDeniedAction } = require("./accessControlService");
const {
  validateSupplierListQuery,
  validateSupplierPayload,
} = require("../validation/supplierValidators");
const { assertCondition } = require("../validation/helpers");

const INVENTORY_CLERK_RESTRICTED_SUPPLIER_FIELDS = [
  "name",
  "contactName",
  "email",
  "phone",
  "accountCode",
  "preferredCategory",
  "paymentTerms",
  "reviewCadence",
  "shipmentCadence",
  "orderingCutoffTime",
  "minimumOrderValue",
  "minimumOrderUnits",
  "logisticsMode",
  "dispatchRegion",
  "receivingWindow",
  "receivingDock",
  "complianceTier",
  "escalationContact",
  "portalReference",
  "trackingUrl",
  "leadTimeDays",
  "serviceLevelTarget",
  "isPreferred",
  "isActive",
];

function hasOwn(objectValue, key) {
  return Object.prototype.hasOwnProperty.call(objectValue || {}, key);
}

function normalizeComparableSupplierField(key, value) {
  if (["isActive", "isPreferred"].includes(key)) {
    return Boolean(value);
  }

  if (["leadTimeDays", "serviceLevelTarget"].includes(key)) {
    return value === null || value === undefined || String(value).trim() === "" ? null : Number(value);
  }

  return String(value || "").trim();
}

function getRestrictedSupplierFieldChanges(existing, payload = {}) {
  return INVENTORY_CLERK_RESTRICTED_SUPPLIER_FIELDS.filter((field) => {
    if (!hasOwn(payload, field)) {
      return false;
    }

    return (
      normalizeComparableSupplierField(field, payload[field]) !==
      normalizeComparableSupplierField(field, existing?.[field])
    );
  });
}

function matchesSupplierSearch(supplier, search) {
  if (!search) return true;
  const haystack = [
    supplier.name,
    supplier.contactName,
    supplier.email,
    supplier.phone,
    supplier.notes,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

async function getSuppliers(query = {}) {
  const filters = validateSupplierListQuery(query);
  const suppliers = await supplierRepository.getSuppliers();

  return suppliers.filter((supplier) => matchesSupplierSearch(supplier, filters.search));
}

async function getSupplierById(id) {
  const supplier = await supplierRepository.getSupplierById(id);

  if (!supplier) {
    throw new AppError(404, "Supplier not found.", {
      code: "SUPPLIER_NOT_FOUND",
    });
  }

  return supplier;
}

async function createSupplier(payload, actor) {
  await assertRoleAllowed({
    actor,
    allowedRoles: ["Owner", "Manager"],
    action: "supplier.create",
    entityType: "supplier",
    entityId: "pending:new",
    message: "Only owners and managers can onboard new suppliers.",
    code: "SUPPLIER_CREATE_ROLE_REQUIRED",
  });

  const supplier = validateSupplierPayload(payload);

  assertCondition(
    !(await supplierRepository.findSupplierByName(supplier.name)),
    "A supplier with this name already exists."
  );

  const createdSupplier = await supplierRepository.createSupplier(supplier);

  await auditLogService.recordAuditEvent({
    actor,
    action: "supplier.created",
    entityType: "supplier",
    entityId: String(createdSupplier.id),
    details: {
      name: createdSupplier.name,
      contactName: createdSupplier.contactName,
      isActive: createdSupplier.isActive,
    },
  });

  return createdSupplier;
}

async function updateSupplier(id, payload, actor) {
  const existing = await getSupplierById(id);
  await assertRoleAllowed({
    actor,
    allowedRoles: ["Owner", "Manager", "Inventory Clerk"],
    action: "supplier.update",
    entityType: "supplier",
    entityId: String(existing.id),
    message: "Only operations staff can update supplier records.",
    code: "SUPPLIER_UPDATE_ROLE_REQUIRED",
  });

  const actorRole = normalizeRole(actor);
  const restrictedFieldChanges =
    actorRole === "Inventory Clerk" ? getRestrictedSupplierFieldChanges(existing, payload) : [];

  if (restrictedFieldChanges.length > 0) {
    await recordDeniedAction({
      actor,
      action: "supplier.update",
      entityType: "supplier",
      entityId: String(existing.id),
      reason:
        "Inventory clerks cannot change supplier identity or commercial contact controls.",
      details: {
        restrictedFields: restrictedFieldChanges,
      },
    });

    throw new AppError(
      403,
      "Inventory clerks can add operational notes, but supplier identity and contact changes require manager or owner approval.",
      {
        code: "SUPPLIER_COMMERCIAL_FIELDS_RESTRICTED",
      }
    );
  }

  const supplier = validateSupplierPayload({
    ...existing,
    ...(payload || {}),
  });

  assertCondition(
    !(await supplierRepository.findSupplierByName(supplier.name, existing.id)),
    "A supplier with this name already exists."
  );

  const updatedSupplier = await supplierRepository.updateSupplier(existing.id, {
    ...existing,
    ...supplier,
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "supplier.updated",
    entityType: "supplier",
    entityId: String(updatedSupplier.id),
    details: {
      previousName: existing.name,
      nextName: updatedSupplier.name,
      isActive: updatedSupplier.isActive,
    },
  });

  return updatedSupplier;
}

async function deleteSupplier(id, actor) {
  const existing = await getSupplierById(id);
  await assertRoleAllowed({
    actor,
    allowedRoles: ["Owner"],
    action: "supplier.delete",
    entityType: "supplier",
    entityId: String(existing.id),
    message: "Only an owner can delete suppliers.",
    code: "SUPPLIER_DELETE_ROLE_REQUIRED",
  });

  try {
    const deletedSupplier = await supplierRepository.deleteSupplier(existing.id);

    await auditLogService.recordAuditEvent({
      actor,
      action: "supplier.deleted",
      entityType: "supplier",
      entityId: String(deletedSupplier.id),
      details: {
        name: deletedSupplier.name,
      },
    });

    return deletedSupplier;
  } catch (error) {
    if (!/referenced by existing records/i.test(String(error?.message || ""))) {
      throw error;
    }

    throw new AppError(
      409,
      "This supplier cannot be deleted because it is referenced by existing business records.",
      {
        code: "SUPPLIER_DELETE_CONFLICT",
      }
    );
  }
}

module.exports = {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
};
