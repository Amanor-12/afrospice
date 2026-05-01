const models = require("../models");
const {
  applySessionToQuery,
  buildExactCaseInsensitiveRegex,
  compactLookupText,
  ensureCounterAtLeast,
  nextSequence,
  safeDate,
  toIsoTimestamp,
  withOptionalTransaction,
} = require("./mongoRepositoryUtils");

const COUNTER_KEY = "supplier_id";

const CATEGORY_OPERATING_DEFAULTS = Object.freeze({
  "food staples": {
    shipmentCadence: "Weekly dry-goods lane",
    orderingCutoffTime: "3:00 PM / 24h notice",
    minimumOrderValue: 300,
    minimumOrderUnits: 20,
    logisticsMode: "Case freight",
    dispatchRegion: "Greater Toronto Area",
    receivingWindow: "06:00-11:00",
    receivingDock: "Dock A",
    complianceTier: "Ambient standard",
  },
  "cooking essentials": {
    shipmentCadence: "Weekly pantry lane",
    orderingCutoffTime: "2:00 PM / 24h notice",
    minimumOrderValue: 250,
    minimumOrderUnits: 15,
    logisticsMode: "Case freight",
    dispatchRegion: "Greater Toronto Area",
    receivingWindow: "06:00-11:00",
    receivingDock: "Dock A",
    complianceTier: "Ambient standard",
  },
  groceries: {
    shipmentCadence: "Twice-weekly grocery lane",
    orderingCutoffTime: "2:00 PM same day",
    minimumOrderValue: 220,
    minimumOrderUnits: 12,
    logisticsMode: "Van route",
    dispatchRegion: "Greater Toronto Area",
    receivingWindow: "06:00-10:00",
    receivingDock: "Dock A",
    complianceTier: "Shelf-stable standard",
  },
  drinks: {
    shipmentCadence: "Twice-weekly beverage lane",
    orderingCutoffTime: "1:00 PM same day",
    minimumOrderValue: 400,
    minimumOrderUnits: 25,
    logisticsMode: "Pallet and case freight",
    dispatchRegion: "Ontario core route",
    receivingWindow: "06:00-10:00",
    receivingDock: "Dock B",
    complianceTier: "Breakage watch",
  },
  dairy: {
    shipmentCadence: "Three-times-weekly cold lane",
    orderingCutoffTime: "11:00 AM / next-day chilled run",
    minimumOrderValue: 150,
    minimumOrderUnits: 8,
    logisticsMode: "Cold-chain route",
    dispatchRegion: "Greater Toronto Area chilled route",
    receivingWindow: "05:30-08:30",
    receivingDock: "Dock C",
    complianceTier: "Cold chain",
  },
  bakery: {
    shipmentCadence: "Daily fresh-bake lane",
    orderingCutoffTime: "7:00 PM previous day",
    minimumOrderValue: 80,
    minimumOrderUnits: 6,
    logisticsMode: "Fresh route",
    dispatchRegion: "Local bakery route",
    receivingWindow: "05:00-07:30",
    receivingDock: "Front receiving",
    complianceTier: "Freshness critical",
  },
  snacks: {
    shipmentCadence: "Weekly snack lane",
    orderingCutoffTime: "1:00 PM / 48h notice",
    minimumOrderValue: 180,
    minimumOrderUnits: 10,
    logisticsMode: "Case freight",
    dispatchRegion: "Ontario packaged route",
    receivingWindow: "06:00-11:00",
    receivingDock: "Dock A",
    complianceTier: "Promotional swing",
  },
  "meat & protein": {
    shipmentCadence: "Twice-weekly protein lane",
    orderingCutoffTime: "10:00 AM / next-day protein run",
    minimumOrderValue: 300,
    minimumOrderUnits: 12,
    logisticsMode: "Temperature-controlled route",
    dispatchRegion: "Ontario cold route",
    receivingWindow: "05:00-07:00",
    receivingDock: "Dock C",
    complianceTier: "Temperature controlled",
  },
});

function withDefaultString(value, fallback = "") {
  const explicit = String(value || "").trim();
  return explicit || String(fallback || "").trim();
}

function withDefaultNumber(value, fallback = null) {
  if (value !== null && value !== undefined && String(value).trim() !== "") {
    return Number(value);
  }

  return fallback === null || fallback === undefined ? null : Number(fallback);
}

function buildSupplierDefaults(row) {
  const categoryDefaults =
    CATEGORY_OPERATING_DEFAULTS[compactLookupText(row?.preferredCategory).toLowerCase()] || {};

  return {
    shipmentCadence: categoryDefaults.shipmentCadence || "",
    orderingCutoffTime: categoryDefaults.orderingCutoffTime || "",
    minimumOrderValue: categoryDefaults.minimumOrderValue ?? null,
    minimumOrderUnits: categoryDefaults.minimumOrderUnits ?? null,
    logisticsMode: categoryDefaults.logisticsMode || "",
    dispatchRegion: categoryDefaults.dispatchRegion || "",
    receivingWindow: categoryDefaults.receivingWindow || "",
    receivingDock: categoryDefaults.receivingDock || "",
    complianceTier: categoryDefaults.complianceTier || "",
    escalationContact:
      withDefaultString(row?.contactName) || withDefaultString(row?.email) || withDefaultString(row?.phone),
    portalReference: withDefaultString(row?.accountCode) ? `Vendor portal / ${withDefaultString(row?.accountCode)}` : "",
  };
}

function normalizeSupplier(row) {
  if (!row) return null;
  const defaults = buildSupplierDefaults(row);

  return {
    id: Number(row.id),
    name: String(row.name || "").trim(),
    contactName: String(row.contactName || "").trim(),
    email: String(row.email || "").trim(),
    phone: String(row.phone || "").trim(),
    accountCode: String(row.accountCode || "").trim(),
    preferredCategory: String(row.preferredCategory || "").trim(),
    paymentTerms: String(row.paymentTerms || "").trim(),
    reviewCadence: String(row.reviewCadence || "").trim(),
    shipmentCadence: withDefaultString(row.shipmentCadence, defaults.shipmentCadence),
    orderingCutoffTime: withDefaultString(row.orderingCutoffTime, defaults.orderingCutoffTime),
    minimumOrderValue: withDefaultNumber(row.minimumOrderValue, defaults.minimumOrderValue),
    minimumOrderUnits: withDefaultNumber(row.minimumOrderUnits, defaults.minimumOrderUnits),
    logisticsMode: withDefaultString(row.logisticsMode, defaults.logisticsMode),
    dispatchRegion: withDefaultString(row.dispatchRegion, defaults.dispatchRegion),
    receivingWindow: withDefaultString(row.receivingWindow, defaults.receivingWindow),
    receivingDock: withDefaultString(row.receivingDock, defaults.receivingDock),
    complianceTier: withDefaultString(row.complianceTier, defaults.complianceTier),
    escalationContact: withDefaultString(row.escalationContact, defaults.escalationContact),
    portalReference: withDefaultString(row.portalReference, defaults.portalReference),
    trackingUrl: String(row.trackingUrl || "").trim(),
    leadTimeDays: row.leadTimeDays === null || row.leadTimeDays === undefined ? null : Number(row.leadTimeDays),
    serviceLevelTarget:
      row.serviceLevelTarget === null || row.serviceLevelTarget === undefined
        ? null
        : Number(row.serviceLevelTarget),
    isPreferred: Boolean(row.isPreferred),
    notes: String(row.notes || "").trim(),
    isActive: row.isActive === undefined ? true : Boolean(row.isActive),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

async function loadSupplierDocument(id, session = null) {
  return applySessionToQuery(
    models.Supplier.findOne({ id: Number(id) }).lean(),
    session
  );
}

async function getSuppliers() {
  const rows = await models.Supplier.find({}).sort({ name: 1 }).lean();
  return rows.map(normalizeSupplier);
}

async function getSupplierById(id) {
  const row = await loadSupplierDocument(id);
  return normalizeSupplier(row);
}

async function findSupplierByName(name, excludeId = null) {
  const normalized = compactLookupText(name);
  if (!normalized) return null;

  const query = {
    name: buildExactCaseInsensitiveRegex(normalized),
  };

  if (excludeId !== null && excludeId !== undefined) {
    query.id = { $ne: Number(excludeId) };
  }

  const row = await models.Supplier.findOne(query).lean();
  return normalizeSupplier(row);
}

async function getNextSupplierId() {
  const row = await models.Supplier.findOne({}).sort({ id: -1 }).select({ id: 1 }).lean();
  return Number(row?.id || 0) + 1;
}

async function createSupplier(supplier) {
  const hasExplicitId = supplier.id !== null && supplier.id !== undefined;
  const id = hasExplicitId ? Number(supplier.id) : await nextSequence(COUNTER_KEY);
  const createdAt = safeDate(supplier.createdAt) || new Date();
  const updatedAt = safeDate(supplier.updatedAt) || createdAt;

  await models.Supplier.create({
    id,
    name: String(supplier.name || "").trim(),
    contactName: String(supplier.contactName || "").trim(),
    email: String(supplier.email || "").trim(),
    phone: String(supplier.phone || "").trim(),
    accountCode: String(supplier.accountCode || "").trim(),
    preferredCategory: String(supplier.preferredCategory || "").trim(),
    paymentTerms: String(supplier.paymentTerms || "").trim(),
    reviewCadence: String(supplier.reviewCadence || "").trim(),
    shipmentCadence: String(supplier.shipmentCadence || "").trim(),
    orderingCutoffTime: String(supplier.orderingCutoffTime || "").trim(),
    minimumOrderValue:
      supplier.minimumOrderValue === null || supplier.minimumOrderValue === undefined
        ? null
        : Number(supplier.minimumOrderValue),
    minimumOrderUnits:
      supplier.minimumOrderUnits === null || supplier.minimumOrderUnits === undefined
        ? null
        : Number(supplier.minimumOrderUnits),
    logisticsMode: String(supplier.logisticsMode || "").trim(),
    dispatchRegion: String(supplier.dispatchRegion || "").trim(),
    receivingWindow: String(supplier.receivingWindow || "").trim(),
    receivingDock: String(supplier.receivingDock || "").trim(),
    complianceTier: String(supplier.complianceTier || "").trim(),
    escalationContact: String(supplier.escalationContact || "").trim(),
    portalReference: String(supplier.portalReference || "").trim(),
    trackingUrl: String(supplier.trackingUrl || "").trim(),
    leadTimeDays: supplier.leadTimeDays === null || supplier.leadTimeDays === undefined ? null : Number(supplier.leadTimeDays),
    serviceLevelTarget:
      supplier.serviceLevelTarget === null || supplier.serviceLevelTarget === undefined
        ? null
        : Number(supplier.serviceLevelTarget),
    isPreferred: Boolean(supplier.isPreferred),
    notes: String(supplier.notes || "").trim(),
    isActive: supplier.isActive === undefined ? true : Boolean(supplier.isActive),
    createdAt,
    updatedAt,
  });

  if (hasExplicitId) {
    await ensureCounterAtLeast(COUNTER_KEY, id);
  }

  return getSupplierById(id);
}

async function updateSupplier(id, supplier) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadSupplierDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeSupplier(existingRow);
    const supplierId = Number(id);
    const previousName = String(existing.name || "").trim();
    const nextName = String(supplier.name || previousName).trim() || previousName;
    const updatedAt = safeDate(supplier.updatedAt) || new Date();

    await models.Supplier.updateOne(
      { id: supplierId },
      {
        $set: {
          name: nextName,
          contactName: String(supplier.contactName || "").trim(),
          email: String(supplier.email || "").trim(),
          phone: String(supplier.phone || "").trim(),
          accountCode: String(supplier.accountCode || "").trim(),
          preferredCategory: String(supplier.preferredCategory || "").trim(),
          paymentTerms: String(supplier.paymentTerms || "").trim(),
          reviewCadence: String(supplier.reviewCadence || "").trim(),
          shipmentCadence: String(supplier.shipmentCadence || "").trim(),
          orderingCutoffTime: String(supplier.orderingCutoffTime || "").trim(),
          minimumOrderValue:
            supplier.minimumOrderValue === null || supplier.minimumOrderValue === undefined
              ? null
              : Number(supplier.minimumOrderValue),
          minimumOrderUnits:
            supplier.minimumOrderUnits === null || supplier.minimumOrderUnits === undefined
              ? null
              : Number(supplier.minimumOrderUnits),
          logisticsMode: String(supplier.logisticsMode || "").trim(),
          dispatchRegion: String(supplier.dispatchRegion || "").trim(),
          receivingWindow: String(supplier.receivingWindow || "").trim(),
          receivingDock: String(supplier.receivingDock || "").trim(),
          complianceTier: String(supplier.complianceTier || "").trim(),
          escalationContact: String(supplier.escalationContact || "").trim(),
          portalReference: String(supplier.portalReference || "").trim(),
          trackingUrl: String(supplier.trackingUrl || "").trim(),
          leadTimeDays:
            supplier.leadTimeDays === null || supplier.leadTimeDays === undefined
              ? null
              : Number(supplier.leadTimeDays),
          serviceLevelTarget:
            supplier.serviceLevelTarget === null || supplier.serviceLevelTarget === undefined
              ? null
              : Number(supplier.serviceLevelTarget),
          isPreferred:
            supplier.isPreferred === undefined ? Boolean(existing.isPreferred) : Boolean(supplier.isPreferred),
          notes: String(supplier.notes || "").trim(),
          isActive: supplier.isActive === undefined ? Boolean(existing.isActive) : Boolean(supplier.isActive),
          updatedAt,
        },
      },
      { session }
    );

    if (previousName.toLowerCase() !== nextName.toLowerCase()) {
      await Promise.all([
        applySessionToQuery(
          models.Product.updateMany(
            {
              $or: [{ supplierId }, { supplier: buildExactCaseInsensitiveRegex(previousName) }],
            },
            {
              $set: {
                supplier: nextName,
                updatedAt,
              },
            }
          ),
          session
        ),
        applySessionToQuery(
          models.PurchaseOrder.updateMany(
            {
              $or: [{ supplierId }, { supplier: buildExactCaseInsensitiveRegex(previousName) }],
            },
            {
              $set: {
                supplier: nextName,
                updatedAt,
              },
            }
          ),
          session
        ),
      ]);
    }

    const updated = await loadSupplierDocument(id, session);
    return normalizeSupplier(updated);
  });
}

async function deleteSupplier(id) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadSupplierDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeSupplier(existingRow);
    const supplierId = Number(id);

    const [productReference, orderReference] = await Promise.all([
      applySessionToQuery(
        models.Product.findOne({
          $or: [{ supplierId }, { supplier: buildExactCaseInsensitiveRegex(existing.name) }],
        })
          .select({ id: 1 })
          .lean(),
        session
      ),
      applySessionToQuery(
        models.PurchaseOrder.findOne({
          $or: [{ supplierId }, { supplier: buildExactCaseInsensitiveRegex(existing.name) }],
        })
          .select({ id: 1 })
          .lean(),
        session
      ),
    ]);

    if (productReference || orderReference) {
      throw new Error("Supplier is referenced by existing records.");
    }

    await models.Supplier.deleteOne({ id: supplierId }, { session });
    return existing;
  });
}

module.exports = {
  createSupplier,
  deleteSupplier,
  findSupplierByName,
  getNextSupplierId,
  getSupplierById,
  getSuppliers,
  updateSupplier,
};
