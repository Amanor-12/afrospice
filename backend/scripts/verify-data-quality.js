require("../src/config/loadEnv");

const { connectDB, disconnectDB } = require("../src/config/db");
const models = require("../src/data/models");

const VALID_USER_ROLES = new Set(["Owner", "Manager", "Cashier", "Inventory Clerk"]);
const VALID_USER_STATUSES = new Set(["Pending Approval", "Active", "Inactive"]);
const VALID_SALE_STATUSES = new Set(["Pending", "Paid", "Declined", "Refunded"]);
const MONEY_TOLERANCE = 0.05;

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function addIssue(list, entity, identifier, message) {
  list.push({ entity, identifier, message });
}

function addWarning(list, entity, identifier, message) {
  list.push({ entity, identifier, message });
}

function nonEmpty(value) {
  return String(value ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function valueOrNull(value) {
  return hasValue(value) ? value : null;
}

function nearlyEqual(left, right, tolerance = MONEY_TOLERANCE) {
  return Math.abs(toNumber(left) - toNumber(right)) <= tolerance;
}

function collectDuplicates(rows, keyLabel, selector, issues, entityName, { ignoreEmpty = true } = {}) {
  const seen = new Map();

  for (const row of rows) {
    const rawValue = selector(row);
    const normalized = typeof rawValue === "number" ? String(rawValue) : nonEmpty(rawValue).toLowerCase();
    if (ignoreEmpty && !normalized) continue;
    const existing = seen.get(normalized);
    if (!existing) {
      seen.set(normalized, row);
      continue;
    }
    addIssue(
      issues,
      entityName,
      `${existing.id ?? existing._id} + ${row.id ?? row._id}`,
      `Duplicate ${keyLabel} detected.`
    );
  }
}

async function run() {
  await connectDB();

  const [
    suppliers,
    products,
    customers,
    users,
    sales,
    purchaseOrders,
    inventoryMovements,
  ] = await Promise.all([
    models.Supplier.find({}).lean(),
    models.Product.find({}).lean(),
    models.Customer.find({}).lean(),
    models.User.find({}).lean(),
    models.Sale.find({}).lean(),
    models.PurchaseOrder.find({}).lean(),
    models.InventoryMovement.find({}).lean(),
  ]);

  const issues = [];
  const warnings = [];

  const supplierById = new Map(suppliers.map((supplier) => [Number(supplier.id), supplier]));
  const productById = new Map(products.map((product) => [Number(product.id), product]));
  const customerById = new Map(customers.map((customer) => [Number(customer.id), customer]));
  const userById = new Map(users.map((user) => [Number(user.id), user]));

  collectDuplicates(suppliers, "supplier name", (row) => row.name, issues, "Supplier");
  collectDuplicates(products, "SKU", (row) => row.sku, issues, "Product");
  collectDuplicates(products, "barcode", (row) => row.barcode, issues, "Product");
  collectDuplicates(customers, "customer name", (row) => row.name, issues, "Customer");
  collectDuplicates(customers, "loyalty card number", (row) => row.loyaltyCardNumber, issues, "Customer");
  collectDuplicates(users, "staff ID", (row) => row.staffId, issues, "User");
  collectDuplicates(users, "email", (row) => row.email, issues, "User");
  collectDuplicates(sales, "sale ID", (row) => row.id, issues, "Sale");
  collectDuplicates(purchaseOrders, "purchase order ID", (row) => row.id, issues, "PurchaseOrder");

  for (const supplier of suppliers) {
    const supplierId = Number(supplier.id);
    if (!nonEmpty(supplier.name)) {
      addIssue(issues, "Supplier", supplierId, "Supplier name is required.");
    }
    if (hasValue(supplier.serviceLevelTarget)) {
      const target = toNumber(supplier.serviceLevelTarget, -1);
      if (target < 0 || target > 100) {
        addIssue(issues, "Supplier", supplierId, "Supplier service level target must stay between 0 and 100.");
      }
    }
    if (hasValue(supplier.minimumOrderValue) && toNumber(supplier.minimumOrderValue, -1) < 0) {
      addIssue(issues, "Supplier", supplierId, "Supplier minimum order value cannot be negative.");
    }
    if (hasValue(supplier.minimumOrderUnits) && toNumber(supplier.minimumOrderUnits, -1) < 0) {
      addIssue(issues, "Supplier", supplierId, "Supplier minimum order units cannot be negative.");
    }
  }

  for (const product of products) {
    const productId = Number(product.id);
    if (!nonEmpty(product.name)) {
      addIssue(issues, "Product", productId, "Product name is required.");
    }
    if (!nonEmpty(product.sku)) {
      addIssue(issues, "Product", productId, "Product SKU is required.");
    }
    if (toNumber(product.price, -1) < 0) {
      addIssue(issues, "Product", productId, "Product price cannot be negative.");
    }
    if (toNumber(product.unitCost, -1) < 0) {
      addIssue(issues, "Product", productId, "Product unit cost cannot be negative.");
    }
    if (toNumber(product.stock, -1) < 0) {
      addIssue(issues, "Product", productId, "Product stock cannot be negative.");
    }
    const stockingValues = [valueOrNull(product.casePack), valueOrNull(product.reorderPoint), valueOrNull(product.parLevel)]
      .filter((value) => value !== null)
      .map((value) => toNumber(value, -1));
    if (stockingValues.some((value) => value < 0)) {
      addIssue(issues, "Product", productId, "Product stocking controls cannot be negative.");
    }
    if (product.supplierId !== null && product.supplierId !== undefined && !supplierById.has(Number(product.supplierId))) {
      addIssue(issues, "Product", productId, "Product supplierId does not resolve to a live supplier.");
    }
  }

  const walkInCustomers = customers.filter((customer) => Boolean(customer.isWalkIn));
  if (walkInCustomers.length !== 1) {
    addIssue(
      issues,
      "Customer",
      "walk-in-profile",
      `Exactly one walk-in customer profile is required; found ${walkInCustomers.length}.`
    );
  }

  for (const customer of customers) {
    const customerId = Number(customer.id);
    if (!nonEmpty(customer.name)) {
      addIssue(issues, "Customer", customerId, "Customer name is required.");
    }
    if (!customer.isWalkIn && !nonEmpty(customer.email) && !nonEmpty(customer.phone)) {
      addWarning(warnings, "Customer", customerId, "Named customer has no email or phone on file.");
    }
  }

  for (const user of users) {
    const userId = Number(user.id);
    if (!VALID_USER_ROLES.has(nonEmpty(user.role))) {
      addIssue(issues, "User", userId, "User role is outside the approved workspace roles.");
    }
    if (!VALID_USER_STATUSES.has(nonEmpty(user.status))) {
      addIssue(issues, "User", userId, "User status is outside the approved access states.");
    }
    if (!nonEmpty(user.email)) {
      addIssue(issues, "User", userId, "User email is required.");
    }
    if (nonEmpty(user.status) === "Active" && !nonEmpty(user.pinHash)) {
      addIssue(issues, "User", userId, "Active user is missing a PIN hash.");
    }
  }

  for (const sale of sales) {
    const saleId = nonEmpty(sale.id) || String(sale._id);
    if (!VALID_SALE_STATUSES.has(nonEmpty(sale.status))) {
      addIssue(issues, "Sale", saleId, "Sale status is outside the approved order states.");
    }
    if (!Array.isArray(sale.items) || sale.items.length === 0) {
      addIssue(issues, "Sale", saleId, "Sale must contain at least one line item.");
      continue;
    }

    const rawItemSubtotal = sale.items.reduce(
      (sum, item) => sum + toNumber(item.lineSubtotal, toNumber(item.price) * toNumber(item.qty)),
      0
    );
    const hasStoredDiscountEnvelope = hasValue(sale.preDiscountSubtotal) || hasValue(sale.discount);
    const expectedSubtotal = hasStoredDiscountEnvelope
      ? toNumber(sale.preDiscountSubtotal, rawItemSubtotal) - toNumber(sale.discount)
      : null;

    if (expectedSubtotal !== null) {
      if (!nearlyEqual(sale.subtotal, expectedSubtotal)) {
        addIssue(issues, "Sale", saleId, "Sale subtotal does not match the stored discount envelope.");
      }
    } else if (toNumber(sale.subtotal) > rawItemSubtotal + MONEY_TOLERANCE) {
      addIssue(issues, "Sale", saleId, "Sale subtotal cannot exceed the raw line-item subtotal.");
    } else if (rawItemSubtotal - toNumber(sale.subtotal) > MONEY_TOLERANCE) {
      addWarning(
        warnings,
        "Sale",
        saleId,
        "Sale subtotal is below the raw line-item subtotal. Basket-level discounting appears to be stored without line-level detail."
      );
    }
    if (!nearlyEqual(sale.total, toNumber(sale.subtotal) + toNumber(sale.tax))) {
      addIssue(issues, "Sale", saleId, "Sale total must equal subtotal plus tax.");
    }
    if (sale.customerId !== null && sale.customerId !== undefined && !customerById.has(Number(sale.customerId))) {
      addIssue(issues, "Sale", saleId, "Sale customerId does not resolve to a live customer.");
    }
    if (sale.cashierUserId !== null && sale.cashierUserId !== undefined && !userById.has(Number(sale.cashierUserId))) {
      addIssue(issues, "Sale", saleId, "Sale cashierUserId does not resolve to a live user.");
    }

    for (const item of sale.items) {
      if (!productById.has(Number(item.id))) {
        addIssue(issues, "Sale", saleId, `Sale line item ${item.sku || item.name || item.id} does not resolve to a live product.`);
      }
      if (toNumber(item.qty, -1) <= 0) {
        addIssue(issues, "Sale", saleId, `Sale line item ${item.sku || item.name || item.id} must have a quantity above zero.`);
      }
    }
  }

  for (const order of purchaseOrders) {
    const orderId = nonEmpty(order.id) || String(order._id);
    if (order.supplierId !== null && order.supplierId !== undefined && !supplierById.has(Number(order.supplierId))) {
      addIssue(issues, "PurchaseOrder", orderId, "Purchase order supplierId does not resolve to a live supplier.");
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      addIssue(issues, "PurchaseOrder", orderId, "Purchase order must contain at least one line item.");
      continue;
    }

    const expectedTotal = order.items.reduce(
      (sum, item) => sum + toNumber(item.qtyOrdered) * toNumber(item.unitCost),
      0
    );

    if (!nearlyEqual(order.totalEstimatedCost, expectedTotal)) {
      addIssue(issues, "PurchaseOrder", orderId, "Purchase order estimated total does not match its line items.");
    }

    for (const item of order.items) {
      if (!productById.has(Number(item.productId))) {
        addIssue(
          issues,
          "PurchaseOrder",
          orderId,
          `Purchase order line ${item.sku || item.productName || item.productId} does not resolve to a live product.`
        );
      }
      if (toNumber(item.qtyOrdered, -1) <= 0) {
        addIssue(
          issues,
          "PurchaseOrder",
          orderId,
          `Purchase order line ${item.sku || item.productName || item.productId} must order more than zero units.`
        );
      }
      if (toNumber(item.qtyReceived) > toNumber(item.qtyOrdered)) {
        addIssue(
          issues,
          "PurchaseOrder",
          orderId,
          `Purchase order line ${item.sku || item.productName || item.productId} received more units than ordered.`
        );
      }
    }
  }

  for (const movement of inventoryMovements) {
    const movementId = Number(movement.id);
    if (!productById.has(Number(movement.productId))) {
      addIssue(issues, "InventoryMovement", movementId, "Inventory movement productId does not resolve to a live product.");
    }

    const hasBefore = movement.quantityBefore !== null && movement.quantityBefore !== undefined;
    const hasAfter = movement.quantityAfter !== null && movement.quantityAfter !== undefined;
    if (hasBefore && hasAfter) {
      const delta = toNumber(movement.quantityAfter) - toNumber(movement.quantityBefore);
      if (!nearlyEqual(delta, movement.quantityDelta, 0.001)) {
        addIssue(issues, "InventoryMovement", movementId, "Inventory movement before/after quantities do not match the delta.");
      }
    }
  }

  printSection("Data Snapshot");
  console.log(`suppliers: ${suppliers.length}`);
  console.log(`products: ${products.length}`);
  console.log(`customers: ${customers.length}`);
  console.log(`users: ${users.length}`);
  console.log(`sales: ${sales.length}`);
  console.log(`purchaseOrders: ${purchaseOrders.length}`);
  console.log(`inventoryMovements: ${inventoryMovements.length}`);

  printSection("Data Quality");
  console.log(`issues: ${issues.length}`);
  console.log(`warnings: ${warnings.length}`);

  if (warnings.length) {
    printSection("Warnings");
    warnings.slice(0, 20).forEach((warning) => {
      console.log(`[WARN] ${warning.entity} ${warning.identifier}: ${warning.message}`);
    });
    if (warnings.length > 20) {
      console.log(`... ${warnings.length - 20} more warnings`);
    }
  }

  if (issues.length) {
    printSection("Failures");
    issues.slice(0, 25).forEach((issue) => {
      console.log(`[FAIL] ${issue.entity} ${issue.identifier}: ${issue.message}`);
    });
    if (issues.length > 25) {
      console.log(`... ${issues.length - 25} more failures`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("PASS: Core business data passed integrity checks.");
}

run()
  .catch((error) => {
    console.error("Data quality verification failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB().catch(() => {});
  });
