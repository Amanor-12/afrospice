const AppError = require("../errors/AppError");
const productRepository = require("../data/repositories/productRepository");
const purchaseOrderRepository = require("../data/repositories/purchaseOrderRepository");
const salesRepository = require("../data/repositories/salesRepository");
const staffOperationsRepository = require("../data/repositories/staffOperationsRepository");
const userRepository = require("../data/repositories/userRepository");
const purchaseOrderService = require("./purchaseOrderService");
const auditLogService = require("./auditLogService");
const { normalizeRole, recordDeniedAction } = require("./accessControlService");
const { compactText } = require("../validation/helpers");

const STAFF_OPERATION_ROLES = ["Owner", "Manager", "Cashier", "Inventory Clerk"];
const STAFF_FLOOR_ROLES = ["Cashier", "Inventory Clerk"];
const FULFILLMENT_STATUSES = ["New", "Picking", "Packed", "Ready", "Issue"];
const TASK_STATUSES = ["Open", "Doing", "Done"];
const STAFF_KIOSK_ACTOR = Object.freeze({
  id: null,
  staffId: "STAFF-KIOSK",
  fullName: "AfroSpice Staff Desk",
  role: "Inventory Clerk",
  department: "Operations",
  status: "Active",
});

function buildActorName(actor) {
  return compactText(actor?.fullName || actor?.staffId || "Staff");
}

function isFloorRole(role = "") {
  return STAFF_FLOOR_ROLES.includes(compactText(role));
}

function isStaffOperationRole(role = "") {
  return STAFF_OPERATION_ROLES.includes(compactText(role));
}

async function resolveStaffActor(actor, action, entityType = "staff_operation", entityId = "snapshot") {
  const role = normalizeRole(actor);
  if (!role) {
    return STAFF_KIOSK_ACTOR;
  }

  if (isStaffOperationRole(role)) {
    return actor;
  }

  await recordDeniedAction({
    actor,
    action,
    entityType,
    entityId: String(entityId),
    reason: "Only active AfroSpice staff can use the staff operations workspace.",
    details: {
      requiredRoles: STAFF_OPERATION_ROLES,
    },
  });

  throw new AppError(403, "Only active AfroSpice staff can use the staff operations workspace.", {
    code: "STAFF_OPERATION_ROLE_REQUIRED",
  });
}

function productImage(product = {}) {
  const normalized = `${product.name || ""} ${product.category || ""}`.toLowerCase();

  if (product.imageUrl) return product.imageUrl;
  if (normalized.includes("bread")) return "/products/Bread Loaf.webp";
  if (normalized.includes("cassava") || normalized.includes("lafu")) return "/products/cassava-flour.webp";
  if (normalized.includes("rice") || normalized.includes("beans")) return "/products/basmati-rice5kg.webp";
  if (normalized.includes("fish") || normalized.includes("catfish") || normalized.includes("mackerel")) return "/products/smoked-catfish.webp";
  if (normalized.includes("turkey") || normalized.includes("chicken")) return "/products/frozen-chicken.webp";
  if (normalized.includes("pepper") || normalized.includes("salt")) return "/products/cooking salt.webp";
  if (normalized.includes("suya") || normalized.includes("jollof")) return "/products/jollof-mix.webp";
  if (normalized.includes("milo") || normalized.includes("milk")) return "/products/milo-tin.webp";
  if (normalized.includes("plantain")) return "/products/plantain-chips.webp";
  if (normalized.includes("ground nut") || normalized.includes("groundnut")) return "/products/groundnut-mix.webp";
  if (normalized.includes("juice") || normalized.includes("malt") || normalized.includes("water")) return "/products/orange-juice.webp";
  if (normalized.includes("palm") || normalized.includes("tomato")) return "/products/tomato-paste.webp";

  return "/hero.png";
}

function productTemperature(product = {}) {
  const normalized = `${product.category || ""} ${product.name || ""}`.toLowerCase();

  if (normalized.includes("frozen") || normalized.includes("fish") || normalized.includes("turkey")) {
    return "Frozen";
  }

  if (normalized.includes("milk") || normalized.includes("juice") || normalized.includes("bread")) {
    return "Chilled";
  }

  return "Ambient";
}

function mapProduct(product = {}) {
  return {
    id: Number(product.id),
    name: compactText(product.name, "Unnamed product"),
    sku: compactText(product.sku, `SKU-${product.id}`),
    category: compactText(product.category, "General"),
    stock: Number(product.stock || 0),
    reorderPoint: Number(product.reorderPoint || 0),
    parLevel: Number(product.parLevel || product.reorderPoint || 0),
    shelfLocation: compactText(product.shelfLocation, "Back stock"),
    unitLabel: compactText(product.unitLabel, "unit"),
    supplier: compactText(product.supplier, "General Supplier"),
    receivingNotes: compactText(product.receivingNotes, "Confirm label, count, and shelf condition."),
    image: productImage(product),
    temperature: productTemperature(product),
  };
}

function resolveOrderStatus(currentStatus) {
  if (currentStatus === "New") return "Picking";
  if (currentStatus === "Picking") return "Packed";
  if (currentStatus === "Packed") return "Ready";
  if (currentStatus === "Issue") return "Picking";
  return "Ready";
}

function normalizeFulfillmentStatus(value, fallback = "") {
  const normalized = compactText(value);
  if (!normalized) return fallback;
  if (!FULFILLMENT_STATUSES.includes(normalized)) {
    throw new AppError(400, "Invalid staff order status.", {
      code: "STAFF_ORDER_STATUS_INVALID",
      details: { allowed: FULFILLMENT_STATUSES },
    });
  }

  return normalized;
}

function normalizeTaskStatus(value, fallback = "") {
  const normalized = compactText(value);
  if (!normalized) return fallback;
  if (!TASK_STATUSES.includes(normalized)) {
    throw new AppError(400, "Invalid staff task status.", {
      code: "STAFF_TASK_STATUS_INVALID",
      details: { allowed: TASK_STATUSES },
    });
  }

  return normalized;
}

function normalizeStockDelta(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed === 0 || Math.abs(parsed) > 5000) {
    throw new AppError(400, "Stock adjustment must be a non-zero whole number.", {
      code: "STAFF_STOCK_DELTA_INVALID",
    });
  }

  return parsed;
}

function lineStateMap(state = {}) {
  return new Map((state.lineStates || []).map((line) => [Number(line.productId), line]));
}

function mapOrder(sale, state, productsById) {
  const states = lineStateMap(state);

  return {
    id: String(sale.id),
    channel: compactText(sale.channel, "In-Store"),
    customer: compactText(sale.customer, "Walk-in Customer"),
    status: state?.fulfillmentStatus || "New",
    priority: state?.priority || "Normal",
    promiseTime: state?.promiseTime || new Date().toISOString(),
    paymentMethod: compactText(sale.paymentMethod, "Card"),
    assignedTo: compactText(state?.assignedTo || sale.cashier, "Unassigned"),
    notes:
      compactText(state?.flagReason) ||
      compactText(state?.staffNote) ||
      "Confirm quantity, bag condition, and customer handoff.",
    items: (sale.items || []).map((item) => {
      const productId = Number(item.id || item.productId || 0);
      const product = productsById.get(productId) || {};
      const lineState = states.get(productId) || {};
      const mappedProduct = mapProduct({
        id: productId,
        name: item.name || product.name,
        sku: item.sku || product.sku,
        category: product.category || "",
        stock: product.stock || 0,
        reorderPoint: product.reorderPoint || 0,
        parLevel: product.parLevel || 0,
        shelfLocation: product.shelfLocation || "Confirm location",
        unitLabel: product.unitLabel || "unit",
        supplier: product.supplier || "",
        receivingNotes: product.receivingNotes || "",
        imageUrl: product.imageUrl || "",
      });

      return {
        productId,
        name: compactText(item.name || product.name, "Order item"),
        sku: compactText(item.sku || product.sku, `SKU-${productId}`),
        qty: Number(item.qty || 0),
        shelfLocation: mappedProduct.shelfLocation,
        image: mappedProduct.image,
        picked: Boolean(lineState.picked),
        temperature: mappedProduct.temperature,
      };
    }),
  };
}

function mapPurchaseOrder(order, productsById) {
  const statusMap = {
    Draft: "Expected",
    Sent: "Expected",
    "Partially Received": "Receiving",
    Received: "Received",
    Cancelled: "Exception",
  };

  return {
    id: String(order.id),
    supplier: compactText(order.supplier, "Supplier"),
    status: statusMap[order.status] || "Expected",
    eta: order.expectedDate || order.updatedAt || order.createdAt || new Date().toISOString(),
    dock: compactText(order.receivingLocation, "Dock A") || "Dock A",
    items: (order.items || []).map((item) => {
      const product = productsById.get(Number(item.productId)) || {};
      return {
        productId: Number(item.productId || 0),
        name: compactText(item.productName || product.name, "Inbound item"),
        expected: Number(item.qtyOrdered || 0),
        received: Number(item.qtyReceived || 0),
        shelfLocation: compactText(product.shelfLocation, "Receiving"),
      };
    }),
  };
}

function resolveShiftWindow(user = {}) {
  const timetable = user.timetable && typeof user.timetable === "object" ? user.timetable : {};
  const dayKey = new Intl.DateTimeFormat("en-US", { weekday: "long" })
    .format(new Date())
    .toLowerCase();
  const today = timetable[dayKey];

  if (today?.active && today.start && today.end) {
    return `${today.start} - ${today.end}`;
  }

  if (user.shiftAssignment && user.shiftAssignment !== "Unassigned") {
    return user.shiftAssignment;
  }

  return "Flexible";
}

function stationForUser(user = {}) {
  const role = String(user.role || "");
  if (role === "Cashier") return "Checkout";
  if (role === "Inventory Clerk") return "Receiving";
  return compactText(user.department, "Operations");
}

function getFloorUsers(users = []) {
  return users
    .filter((user) => String(user.status) === "Active")
    .filter((user) => isFloorRole(user.role))
    .sort((left, right) => {
      const roleCompare = String(left.role || "").localeCompare(String(right.role || ""));
      if (roleCompare !== 0) return roleCompare;
      return String(left.fullName || "").localeCompare(String(right.fullName || ""));
    });
}

function buildTaskOwnerDirectory(users = []) {
  const floorUsers = getFloorUsers(users);
  const byId = new Map(
    floorUsers
      .filter((user) => user.id !== null && user.id !== undefined)
      .map((user) => [Number(user.id), user])
  );

  return {
    byId,
    floorUsers,
    primaryCashier: floorUsers.find((user) => compactText(user.role) === "Cashier") || null,
    primaryInventory:
      floorUsers.find((user) => compactText(user.role) === "Inventory Clerk") || null,
    anyFloor: floorUsers[0] || null,
  };
}

function fallbackTaskOwner(task = {}, directory) {
  const area = `${task.area || ""} ${task.title || ""}`.toLowerCase();

  if (
    area.includes("freezer") ||
    area.includes("cold") ||
    area.includes("inventory") ||
    area.includes("receiving") ||
    area.includes("stock")
  ) {
    return directory.primaryInventory || directory.primaryCashier || directory.anyFloor;
  }

  if (area.includes("pickup") || area.includes("checkout") || area.includes("bagging")) {
    return directory.primaryCashier || directory.primaryInventory || directory.anyFloor;
  }

  return directory.primaryCashier || directory.primaryInventory || directory.anyFloor;
}

function mapTeamMember(user = {}) {
  return {
    id: compactText(user.staffId, String(user.id)),
    name: compactText(user.fullName, user.staffId),
    role: compactText(user.role, "Support"),
    station: stationForUser(user),
    shift: resolveShiftWindow(user),
    status: String(user.status) === "Active" ? "On floor" : "Handoff",
  };
}

function mapTask(task = {}, ownerDirectory = buildTaskOwnerDirectory()) {
  const ownedUser = ownerDirectory.byId.get(Number(task.ownerUserId));
  const effectiveOwner =
    ownedUser && isFloorRole(ownedUser.role) ? ownedUser : fallbackTaskOwner(task, ownerDirectory);

  return {
    id: compactText(task.id),
    title: compactText(task.title),
    area: compactText(task.area),
    owner: effectiveOwner
      ? compactText(effectiveOwner.fullName, task.owner || "Unassigned")
      : compactText(task.owner, "Unassigned"),
    due: task.dueAt || new Date().toISOString(),
    priority: task.priority || "Normal",
    status: task.status || "Open",
  };
}

async function buildSnapshot(actor) {
  const staffActor = await resolveStaffActor(actor, "staff.snapshot.read");

  const [rawProducts, rawSales, rawPurchaseOrders, rawUsers] = await Promise.all([
    productRepository.getProducts(),
    salesRepository.getSales(),
    purchaseOrderRepository.getPurchaseOrders(12),
    userRepository.getUsers(),
  ]);
  const products = rawProducts.map(mapProduct);
  const productsById = new Map(rawProducts.map((product) => [Number(product.id), product]));
  const eligibleSales = rawSales
    .filter((sale) => !["Declined", "Refunded"].includes(String(sale.status || "").trim()))
    .filter((sale) => Array.isArray(sale.items) && sale.items.length > 0)
    .slice(0, 12);

  const orderStates = [];
  for (const [index, sale] of eligibleSales.entries()) {
    // eslint-disable-next-line no-await-in-loop
    orderStates.push(
      await staffOperationsRepository.ensureOrderStateForSale(sale, { index, actor: staffActor })
    );
  }

  const statesBySaleId = new Map(orderStates.filter(Boolean).map((state) => [state.saleId, state]));
  const tasks = await staffOperationsRepository.getStaffTasks(rawUsers);
  const ownerDirectory = buildTaskOwnerDirectory(rawUsers);
  const floorUsers = getFloorUsers(rawUsers);

  return {
    generatedAt: new Date().toISOString(),
    source: "backend",
    products,
    orders: eligibleSales.map((sale) => mapOrder(sale, statesBySaleId.get(String(sale.id)), productsById)),
    purchaseOrders: rawPurchaseOrders.map((order) => mapPurchaseOrder(order, productsById)),
    tasks: tasks.map((task) => mapTask(task, ownerDirectory)),
    team: floorUsers.map(mapTeamMember),
  };
}

async function getStaffOrder(orderId, actor) {
  const staffActor = await resolveStaffActor(actor, "staff.order.read", "sale", orderId);
  const [sale, rawProducts] = await Promise.all([
    salesRepository.getSaleById(orderId),
    productRepository.getProducts(),
  ]);

  if (!sale) {
    throw new AppError(404, "Order not found.", {
      code: "STAFF_ORDER_NOT_FOUND",
    });
  }

  const state = await staffOperationsRepository.ensureOrderStateForSale(sale, { actor: staffActor });
  const productsById = new Map(rawProducts.map((product) => [Number(product.id), product]));
  return mapOrder(sale, state, productsById);
}

async function advanceOrder(orderId, payload = {}, actor) {
  const staffActor = await resolveStaffActor(actor, "staff.order.advance", "sale", orderId);
  const sale = await salesRepository.getSaleById(orderId);

  if (!sale) {
    throw new AppError(404, "Order not found.", {
      code: "STAFF_ORDER_NOT_FOUND",
    });
  }

  const current = await staffOperationsRepository.ensureOrderStateForSale(sale, {
    actor: staffActor,
  });
  const nextStatus = normalizeFulfillmentStatus(
    payload.status,
    resolveOrderStatus(current.fulfillmentStatus)
  );
  let updated = await staffOperationsRepository.updateOrderStatus(orderId, nextStatus, {
    actor: staffActor,
    note: payload.note,
  });

  if (["Packed", "Ready"].includes(nextStatus)) {
    for (const item of sale.items || []) {
      // eslint-disable-next-line no-await-in-loop
      updated = await staffOperationsRepository.updateOrderLineState(orderId, item.id, {
        actor: staffActor,
        picked: true,
        pickedQty: item.qty,
      });
    }
  }

  await auditLogService.recordAuditEvent({
    actor: staffActor,
    action: "staff.order_advanced",
    entityType: "sale",
    entityId: String(orderId),
    details: {
      previousStatus: current.fulfillmentStatus,
      nextStatus,
    },
  });

  return getStaffOrder(orderId, actor);
}

async function flagOrder(orderId, payload = {}, actor) {
  const staffActor = await resolveStaffActor(actor, "staff.order.flag", "sale", orderId);
  const sale = await salesRepository.getSaleById(orderId);

  if (!sale) {
    throw new AppError(404, "Order not found.", {
      code: "STAFF_ORDER_NOT_FOUND",
    });
  }

  await staffOperationsRepository.ensureOrderStateForSale(sale, { actor: staffActor });
  const updated = await staffOperationsRepository.flagOrder(orderId, {
    actor: staffActor,
    note: payload.note,
  });

  await auditLogService.recordAuditEvent({
    actor: staffActor,
    action: "staff.order_flagged",
    entityType: "sale",
    entityId: String(orderId),
    details: {
      reason: updated?.flagReason || payload.note || "",
    },
  });

  return getStaffOrder(orderId, actor);
}

async function updatePickLine(orderId, productId, payload = {}, actor) {
  const staffActor = await resolveStaffActor(actor, "staff.order.pick_line", "sale", orderId);
  const sale = await salesRepository.getSaleById(orderId);

  if (!sale) {
    throw new AppError(404, "Order not found.", {
      code: "STAFF_ORDER_NOT_FOUND",
    });
  }

  const line = (sale.items || []).find((item) => Number(item.id) === Number(productId));
  if (!line) {
    throw new AppError(404, "Order line not found.", {
      code: "STAFF_ORDER_LINE_NOT_FOUND",
    });
  }

  await staffOperationsRepository.ensureOrderStateForSale(sale, { actor: staffActor });
  await staffOperationsRepository.updateOrderLineState(orderId, productId, {
    actor: staffActor,
    picked: payload.picked,
    pickedQty: line.qty,
  });

  await auditLogService.recordAuditEvent({
    actor: staffActor,
    action: "staff.order_line_picked",
    entityType: "sale",
    entityId: String(orderId),
    details: {
      productId: Number(productId),
      picked: Boolean(payload.picked),
    },
  });

  return getStaffOrder(orderId, actor);
}

async function adjustProductStock(productId, payload = {}, actor) {
  const staffActor = await resolveStaffActor(
    actor,
    "staff.product.stock_adjust",
    "product",
    productId
  );
  const product = await productRepository.getProductById(productId);

  if (!product) {
    throw new AppError(404, "Product not found.", {
      code: "STAFF_PRODUCT_NOT_FOUND",
    });
  }

  const delta = normalizeStockDelta(payload.delta);
  if (Number(product.stock || 0) + delta < 0) {
    throw new AppError(409, "Stock cannot go below zero.", {
      code: "STAFF_STOCK_NEGATIVE",
    });
  }

  const updated = await productRepository.restockProductWithMovement(productId, delta, {
    movementType: delta > 0 ? "staff_adjustment_increase" : "staff_adjustment_decrease",
    referenceType: "staff_workspace",
    referenceId: `staff:${productId}`,
    note: compactText(payload.reason, "Staff shelf count adjustment."),
    actorName: buildActorName(staffActor),
  });

  await auditLogService.recordAuditEvent({
    actor: staffActor,
    action: "staff.product_stock_adjusted",
    entityType: "product",
    entityId: String(productId),
    details: {
      delta,
      previousStock: product.stock,
      nextStock: updated?.stock,
      reason: payload.reason || "",
    },
  });

  return mapProduct(updated);
}

async function receivePurchaseOrder(orderId, payload = {}, actor) {
  const staffActor = await resolveStaffActor(
    actor,
    "staff.purchase_order.receive_all",
    "purchase_order",
    orderId
  );
  const order = await purchaseOrderService.receivePurchaseOrder(
    orderId,
    {
      note: compactText(payload.note, "Received from staff workspace."),
    },
    staffActor
  );
  const products = await productRepository.getProducts();
  const productsById = new Map(products.map((product) => [Number(product.id), product]));

  return mapPurchaseOrder(order, productsById);
}

async function updateTask(taskId, payload = {}, actor) {
  const staffActor = await resolveStaffActor(actor, "staff.task.update", "staff_task", taskId);
  const users = await userRepository.getUsers();
  const existingTasks = await staffOperationsRepository.getStaffTasks(users);
  const existing = existingTasks.find((task) => task.id === String(taskId));

  if (!existing) {
    throw new AppError(404, "Staff task not found.", {
      code: "STAFF_TASK_NOT_FOUND",
    });
  }

  const defaultNext = existing.status === "Open" ? "Doing" : existing.status === "Doing" ? "Done" : "Open";
  const status = normalizeTaskStatus(payload.status, defaultNext);
  const task = await staffOperationsRepository.updateTaskStatus(taskId, status, {
    actor: staffActor,
    note: payload.note,
  });

  await auditLogService.recordAuditEvent({
    actor: staffActor,
    action: "staff.task_updated",
    entityType: "staff_task",
    entityId: String(taskId),
    details: {
      previousStatus: existing.status,
      nextStatus: status,
    },
  });

  return mapTask(task, buildTaskOwnerDirectory(users));
}

module.exports = {
  adjustProductStock,
  advanceOrder,
  buildSnapshot,
  flagOrder,
  receivePurchaseOrder,
  updatePickLine,
  updateTask,
};
