const models = require("../models");
const {
  compactLookupText,
  safeDate,
  toIsoTimestamp,
  toNullableIsoTimestamp,
} = require("./mongoRepositoryUtils");

const ORDER_STATUSES = new Set(["New", "Picking", "Packed", "Ready", "Issue"]);
const PRIORITIES = new Set(["Normal", "High", "Critical"]);
const TASK_STATUSES = new Set(["Open", "Doing", "Done"]);

function buildActorSnapshot(actor = null) {
  return {
    actorUserId: actor?.id === null || actor?.id === undefined ? null : Number(actor.id),
    actorName: compactLookupText(actor?.fullName || actor?.staffId, "System"),
  };
}

function normalizeOrderStatus(value, fallback = "New") {
  const normalized = compactLookupText(value, fallback);
  return ORDER_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizePriority(value, fallback = "Normal") {
  const normalized = compactLookupText(value, fallback);
  return PRIORITIES.has(normalized) ? normalized : fallback;
}

function normalizeTaskStatus(value, fallback = "Open") {
  const normalized = compactLookupText(value, fallback);
  return TASK_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeLineState(row = {}) {
  return {
    productId: Number(row.productId || 0),
    picked: Boolean(row.picked),
    pickedQty: Number(row.pickedQty || 0),
    pickedAt: toNullableIsoTimestamp(row.pickedAt),
    pickedByUserId:
      row.pickedByUserId === null || row.pickedByUserId === undefined
        ? null
        : Number(row.pickedByUserId),
    pickedByName: compactLookupText(row.pickedByName),
  };
}

function normalizeStatusEvent(row = {}) {
  return {
    fromStatus: compactLookupText(row.fromStatus),
    toStatus: compactLookupText(row.toStatus),
    note: compactLookupText(row.note),
    actorUserId:
      row.actorUserId === null || row.actorUserId === undefined ? null : Number(row.actorUserId),
    actorName: compactLookupText(row.actorName),
    createdAt: toIsoTimestamp(row.createdAt),
  };
}

function normalizeOrderWorkState(row) {
  if (!row) return null;

  return {
    saleId: compactLookupText(row.saleId),
    fulfillmentStatus: normalizeOrderStatus(row.fulfillmentStatus),
    priority: normalizePriority(row.priority),
    promiseTime: toIsoTimestamp(row.promiseTime),
    assignedTo: compactLookupText(row.assignedTo, "Unassigned"),
    assignedUserId:
      row.assignedUserId === null || row.assignedUserId === undefined
        ? null
        : Number(row.assignedUserId),
    staffNote: compactLookupText(row.staffNote),
    flagReason: compactLookupText(row.flagReason),
    lineStates: Array.isArray(row.lineStates) ? row.lineStates.map(normalizeLineState) : [],
    statusHistory: Array.isArray(row.statusHistory)
      ? row.statusHistory.map(normalizeStatusEvent)
      : [],
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

function normalizeTask(row) {
  if (!row) return null;

  return {
    id: compactLookupText(row.id),
    title: compactLookupText(row.title),
    area: compactLookupText(row.area),
    owner: compactLookupText(row.owner, "Unassigned"),
    ownerUserId:
      row.ownerUserId === null || row.ownerUserId === undefined ? null : Number(row.ownerUserId),
    dueAt: toIsoTimestamp(row.dueAt),
    priority: normalizePriority(row.priority),
    status: normalizeTaskStatus(row.status),
    source: compactLookupText(row.source, "system"),
    completedAt: toNullableIsoTimestamp(row.completedAt),
    statusHistory: Array.isArray(row.statusHistory)
      ? row.statusHistory.map(normalizeStatusEvent)
      : [],
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

function buildPromiseTime(sale = {}, index = 0) {
  const saleDate = safeDate(sale.date || sale.createdAt);
  const now = Date.now();

  if (saleDate && now - saleDate.getTime() < 6 * 60 * 60 * 1000) {
    return new Date(saleDate.getTime() + (24 + index * 8) * 60 * 1000);
  }

  return new Date(now + (18 + index * 12) * 60 * 1000);
}

function buildInitialPriority(sale = {}, index = 0) {
  const channel = String(sale.channel || "").toLowerCase();
  if (channel.includes("phone") || channel.includes("delivery")) return "High";
  if (index % 5 === 0) return "Critical";
  return "Normal";
}

function buildInitialLineStates(sale = {}) {
  return (Array.isArray(sale.items) ? sale.items : [])
    .map((item) => ({
      productId: Number(item.id || item.productId || 0),
      picked: false,
      pickedQty: 0,
      pickedAt: null,
      pickedByUserId: null,
      pickedByName: "",
    }))
    .filter((item) => item.productId > 0);
}

async function syncLineStatesForSale(existing, sale) {
  const current = Array.isArray(existing.lineStates) ? existing.lineStates.map(normalizeLineState) : [];
  const currentProductIds = new Set(current.map((line) => Number(line.productId)));
  const missing = buildInitialLineStates(sale).filter((line) => !currentProductIds.has(line.productId));

  if (!missing.length) {
    return existing;
  }

  const lineStates = [...current, ...missing];
  await models.StaffOrderWorkState.updateOne(
    { saleId: String(existing.saleId) },
    {
      $set: {
        lineStates,
        updatedAt: new Date(),
      },
    }
  );

  const updated = await models.StaffOrderWorkState.findOne({ saleId: String(existing.saleId) }).lean();
  return normalizeOrderWorkState(updated);
}

async function ensureOrderStateForSale(sale, { index = 0, actor = null } = {}) {
  const saleId = compactLookupText(sale?.id);
  if (!saleId) return null;

  const now = new Date();
  const actorSnapshot = buildActorSnapshot(actor);
  const created = await models.StaffOrderWorkState.findOneAndUpdate(
    { saleId },
    {
      $setOnInsert: {
        saleId,
        fulfillmentStatus: "New",
        priority: buildInitialPriority(sale, index),
        promiseTime: buildPromiseTime(sale, index),
        assignedTo: compactLookupText(sale.cashier, "Unassigned"),
        assignedUserId: sale.cashierUserId === null || sale.cashierUserId === undefined ? null : Number(sale.cashierUserId),
        staffNote: "Confirm quantity, bag condition, and customer handoff.",
        flagReason: "",
        lineStates: buildInitialLineStates(sale),
        statusHistory: [
          {
            fromStatus: "",
            toStatus: "New",
            note: "Staff workflow initialized.",
            ...actorSnapshot,
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    },
    {
      upsert: true,
      new: true,
      lean: true,
    }
  );

  return syncLineStatesForSale(normalizeOrderWorkState(created), sale);
}

async function getOrderStatesBySaleIds(saleIds = []) {
  const ids = [...new Set(saleIds.map((id) => compactLookupText(id)).filter(Boolean))];
  if (!ids.length) return [];

  const rows = await models.StaffOrderWorkState.find({ saleId: { $in: ids } }).lean();
  return rows.map(normalizeOrderWorkState);
}

async function getOrderStateBySaleId(saleId) {
  const row = await models.StaffOrderWorkState.findOne({
    saleId: compactLookupText(saleId),
  }).lean();
  return normalizeOrderWorkState(row);
}

async function updateOrderStatus(saleId, status, { actor = null, note = "", priority = null } = {}) {
  const existing = await getOrderStateBySaleId(saleId);
  if (!existing) return null;

  const nextStatus = normalizeOrderStatus(status, existing.fulfillmentStatus);
  const now = new Date();
  const actorSnapshot = buildActorSnapshot(actor);
  const set = {
    fulfillmentStatus: nextStatus,
    updatedAt: now,
  };

  if (nextStatus === "Picking" && existing.assignedTo === "Unassigned") {
    set.assignedTo = actorSnapshot.actorName;
    set.assignedUserId = actorSnapshot.actorUserId;
  }

  if (priority) {
    set.priority = normalizePriority(priority, existing.priority);
  }

  if (note) {
    set.staffNote = compactLookupText(note);
  }

  await models.StaffOrderWorkState.updateOne(
    { saleId: compactLookupText(saleId) },
    {
      $set: set,
      $push: {
        statusHistory: {
          fromStatus: existing.fulfillmentStatus,
          toStatus: nextStatus,
          note: compactLookupText(note),
          ...actorSnapshot,
          createdAt: now,
        },
      },
    }
  );

  return getOrderStateBySaleId(saleId);
}

async function flagOrder(saleId, { actor = null, note = "" } = {}) {
  const reason =
    compactLookupText(note) ||
    "Staff flagged this order. Confirm substitution, payment, or customer handoff before release.";
  const updated = await updateOrderStatus(saleId, "Issue", {
    actor,
    note: reason,
    priority: "Critical",
  });

  if (!updated) return null;

  await models.StaffOrderWorkState.updateOne(
    { saleId: compactLookupText(saleId) },
    {
      $set: {
        flagReason: reason,
        priority: "Critical",
        updatedAt: new Date(),
      },
    }
  );

  return getOrderStateBySaleId(saleId);
}

async function updateOrderLineState(saleId, productId, { actor = null, picked = true, pickedQty = 0 } = {}) {
  const existing = await getOrderStateBySaleId(saleId);
  if (!existing) return null;

  const actorSnapshot = buildActorSnapshot(actor);
  const targetProductId = Number(productId);
  const now = new Date();
  const lineStates = existing.lineStates.map((line) =>
    Number(line.productId) === targetProductId
      ? {
          ...line,
          picked: Boolean(picked),
          pickedQty: Boolean(picked) ? Number(pickedQty || line.pickedQty || 1) : 0,
          pickedAt: Boolean(picked) ? now.toISOString() : null,
          pickedByUserId: Boolean(picked) ? actorSnapshot.actorUserId : null,
          pickedByName: Boolean(picked) ? actorSnapshot.actorName : "",
        }
      : line
  );

  if (!lineStates.some((line) => Number(line.productId) === targetProductId)) {
    lineStates.push({
      productId: targetProductId,
      picked: Boolean(picked),
      pickedQty: Boolean(picked) ? Number(pickedQty || 1) : 0,
      pickedAt: Boolean(picked) ? now.toISOString() : null,
      pickedByUserId: Boolean(picked) ? actorSnapshot.actorUserId : null,
      pickedByName: Boolean(picked) ? actorSnapshot.actorName : "",
    });
  }

  await models.StaffOrderWorkState.updateOne(
    { saleId: compactLookupText(saleId) },
    {
      $set: {
        lineStates,
        updatedAt: now,
      },
    }
  );

  return getOrderStateBySaleId(saleId);
}

function buildDefaultTasks(users = []) {
  const now = Date.now();
  const activeUsers = users.filter((user) => String(user.status || "Active") === "Active");
  const floorUsers = activeUsers.filter((user) =>
    ["Cashier", "Inventory Clerk"].includes(String(user.role || "").trim())
  );
  const cashier =
    floorUsers.find((user) => String(user.role || "").trim() === "Cashier") || floorUsers[0] || {};
  const inventory =
    floorUsers.find((user) => String(user.role || "").trim() === "Inventory Clerk") ||
    cashier ||
    floorUsers[0] ||
    {};

  return [
    {
      id: "T-801",
      title: "Run freezer temperature log",
      area: "Cold chain",
      owner: compactLookupText(inventory.fullName, "Inventory Clerk"),
      ownerUserId: inventory.id ?? null,
      dueAt: new Date(now + 12 * 60 * 1000),
      priority: "Critical",
      status: "Open",
      source: "system",
    },
    {
      id: "T-802",
      title: "Front-face snack lane before evening rush",
      area: "Sales floor",
      owner: compactLookupText(cashier.fullName, "Cashier"),
      ownerUserId: cashier.id ?? null,
      dueAt: new Date(now + 46 * 60 * 1000),
      priority: "High",
      status: "Doing",
      source: "system",
    },
    {
      id: "T-803",
      title: "Count beverage short shelf",
      area: "Inventory",
      owner: compactLookupText(inventory.fullName, "Inventory Clerk"),
      ownerUserId: inventory.id ?? null,
      dueAt: new Date(now + 72 * 60 * 1000),
      priority: "Normal",
      status: "Open",
      source: "system",
    },
    {
      id: "T-804",
      title: "Sanitize pickup shelf and bagging station",
      area: "Pickup",
      owner: compactLookupText(cashier.fullName, "Cashier"),
      ownerUserId: cashier.id ?? null,
      dueAt: new Date(now + 90 * 60 * 1000),
      priority: "Normal",
      status: "Open",
      source: "system",
    },
  ];
}

async function ensureDefaultTasks(users = []) {
  const count = await models.StaffTask.countDocuments({});
  if (count > 0) return;

  const now = new Date();
  await models.StaffTask.insertMany(
    buildDefaultTasks(users).map((task) => ({
      ...task,
      statusHistory: [
        {
          fromStatus: "",
          toStatus: task.status,
          note: "Default staff task created.",
          actorUserId: null,
          actorName: "System",
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    })),
    { ordered: false }
  ).catch((error) => {
    if (error?.code !== 11000) throw error;
  });
}

async function getStaffTasks(users = []) {
  await ensureDefaultTasks(users);
  const rows = await models.StaffTask.find({}).sort({ status: 1, dueAt: 1, id: 1 }).lean();
  return rows.map(normalizeTask);
}

async function updateTaskStatus(id, status, { actor = null, note = "" } = {}) {
  const existing = normalizeTask(
    await models.StaffTask.findOne({ id: compactLookupText(id) }).lean()
  );
  if (!existing) return null;

  const nextStatus = normalizeTaskStatus(status, existing.status);
  const now = new Date();
  const actorSnapshot = buildActorSnapshot(actor);

  await models.StaffTask.updateOne(
    { id: existing.id },
    {
      $set: {
        status: nextStatus,
        completedAt: nextStatus === "Done" ? now : null,
        updatedAt: now,
      },
      $push: {
        statusHistory: {
          fromStatus: existing.status,
          toStatus: nextStatus,
          note: compactLookupText(note),
          ...actorSnapshot,
          createdAt: now,
        },
      },
    }
  );

  return normalizeTask(await models.StaffTask.findOne({ id: existing.id }).lean());
}

module.exports = {
  ensureOrderStateForSale,
  flagOrder,
  getOrderStateBySaleId,
  getOrderStatesBySaleIds,
  getStaffTasks,
  updateOrderLineState,
  updateOrderStatus,
  updateTaskStatus,
};
