const defaultSettings = require("../defaultSettings");
const models = require("../models");
const {
  getProductTaxProfile,
  normalizeStoredTaxClass,
} = require("../../tax/ontarioProductTax");
const {
  applySessionToQuery,
  buildExactCaseInsensitiveRegex,
  compactLookupText,
  ensureCounterAtLeast,
  lookupKey,
  nextSequence,
  parseNumericFromId,
  safeDate,
  toIsoTimestamp,
  toNullableIsoTimestamp,
  withOptionalTransaction,
} = require("./mongoRepositoryUtils");

const COUNTER_KEYS = {
  customer: "customer_id",
  inventoryMovement: "inventory_movement_id",
  sale: "sale_id",
};

function normalizeProduct(row) {
  if (!row) return null;
  const taxProfile = getProductTaxProfile(row);

  return {
    id: Number(row.id),
    name: String(row.name || "").trim(),
    sku: String(row.sku || "").trim(),
    barcode: String(row.barcode || "").trim(),
    price: Number(row.price || 0),
    unitCost: Number(row.unitCost || 0),
    stock: Number(row.stock || 0),
    category: String(row.category || "General").trim() || "General",
    supplierId: row.supplierId === null || row.supplierId === undefined ? null : Number(row.supplierId),
    supplier: compactLookupText(row.supplier, "General Supplier"),
    ...taxProfile,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

function normalizeSaleItem(row, fallbackTimestamp = null) {
  const lineBaseSubtotal = Number(row?.lineBaseSubtotal ?? Number(row?.qty || 0) * Number(row?.price || 0));
  const discountAmount = Number(row?.discountAmount || 0);
  const lineSubtotal = Number(row?.lineSubtotal ?? Math.max(0, lineBaseSubtotal - discountAmount));

  return {
    id: Number(row?.id || 0),
    name: String(row?.name || "").trim(),
    sku: String(row?.sku || "").trim(),
    qty: Number(row?.qty || 0),
    price: Number(row?.price || 0),
    unitCost: Number(row?.unitCost || 0),
    taxClass: normalizeStoredTaxClass(row?.taxClass),
    taxCode: String(row?.taxCode || "").trim(),
    taxLabel: String(row?.taxLabel || "").trim(),
    taxRate: Number(row?.taxRate || 0),
    isTaxable:
      row?.isTaxable === undefined ? Number(row?.taxRate || 0) > 0 : Boolean(row?.isTaxable),
    discountPercent: Number(row?.discountPercent || 0),
    discountAmount,
    lineBaseSubtotal,
    lineSubtotal,
    taxAmount: Number(row?.taxAmount || 0),
    lineTotal: Number(row?.lineTotal ?? lineSubtotal),
    lineGrossTotal: Number(
      row?.lineGrossTotal ??
        Number(row?.lineTotal ?? lineSubtotal) +
          Number(row?.taxAmount || 0)
    ),
    createdAt: toIsoTimestamp(row?.createdAt, fallbackTimestamp),
    updatedAt: toIsoTimestamp(row?.updatedAt, row?.createdAt || fallbackTimestamp),
  };
}

function normalizeSaleRefund(row) {
  return {
    reason: String(row?.reason || "").trim(),
    note: String(row?.note || "").trim(),
    refundedAt: toNullableIsoTimestamp(row?.refundedAt),
    refundedByUserId:
      row?.refundedByUserId === null || row?.refundedByUserId === undefined
        ? null
        : Number(row.refundedByUserId),
    refundedByName: String(row?.refundedByName || "").trim(),
    approvalPinVerified: Boolean(row?.approvalPinVerified),
  };
}

function normalizeSaleRefundRequest(row) {
  return {
    status: String(row?.status || "None").trim() || "None",
    reason: String(row?.reason || "").trim(),
    note: String(row?.note || "").trim(),
    incidentReport: String(row?.incidentReport || "").trim(),
    customerStatement: String(row?.customerStatement || "").trim(),
    requestedAt: toNullableIsoTimestamp(row?.requestedAt),
    requestedByUserId:
      row?.requestedByUserId === null || row?.requestedByUserId === undefined
        ? null
        : Number(row.requestedByUserId),
    requestedByName: String(row?.requestedByName || "").trim(),
    reviewedAt: toNullableIsoTimestamp(row?.reviewedAt),
    reviewedByUserId:
      row?.reviewedByUserId === null || row?.reviewedByUserId === undefined
        ? null
        : Number(row.reviewedByUserId),
    reviewedByName: String(row?.reviewedByName || "").trim(),
    decisionNote: String(row?.decisionNote || "").trim(),
    approvalPinVerified: Boolean(row?.approvalPinVerified),
  };
}

function normalizeSaleStatusEvent(row) {
  return {
    fromStatus: String(row?.fromStatus || "").trim(),
    toStatus: String(row?.toStatus || "").trim(),
    reason: String(row?.reason || "").trim(),
    note: String(row?.note || "").trim(),
    actorUserId:
      row?.actorUserId === null || row?.actorUserId === undefined
        ? null
        : Number(row.actorUserId),
    actorName: String(row?.actorName || "").trim(),
    approvalPinVerified: Boolean(row?.approvalPinVerified),
    createdAt: toIsoTimestamp(row?.createdAt),
  };
}

function normalizeSale(row) {
  if (!row) return null;

  return {
    id: String(row.id || "").trim(),
    preDiscountSubtotal: Number((row.preDiscountSubtotal ?? row.subtotal) || 0),
    discount: Number(row.discount || 0),
    subtotal: Number(row.subtotal || 0),
    tax: Number(row.tax || 0),
    total: Number(row.total || 0),
    cashierUserId:
      row.cashierUserId === null || row.cashierUserId === undefined
        ? null
        : Number(row.cashierUserId),
    cashier: String(row.cashier || "Front Desk").trim() || "Front Desk",
    customerId:
      row.customerId === null || row.customerId === undefined ? null : Number(row.customerId),
    customer: compactLookupText(row.customer, "Walk-in Customer"),
    customerDiscountPercent: Number(row.customerDiscountPercent || 0),
    customerLoyaltyTier: String(row.customerLoyaltyTier || "").trim(),
    customerLoyaltyNumber: String(row.customerLoyaltyNumber || "").trim(),
    status: String(row.status || "Pending").trim() || "Pending",
    channel: String(row.channel || "In-Store").trim() || "In-Store",
    paymentMethod: String(row.paymentMethod || "Card").trim() || "Card",
    date: toIsoTimestamp(row.date, row.createdAt),
    createdAt: toIsoTimestamp(row.createdAt, row.date),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt || row.date),
    items: Array.isArray(row.items)
      ? row.items.map((item) => normalizeSaleItem(item, row.createdAt || row.date))
      : [],
    refund: normalizeSaleRefund(row.refund),
    refundRequest: normalizeSaleRefundRequest(row.refundRequest),
    statusHistory: Array.isArray(row.statusHistory)
      ? row.statusHistory.map(normalizeSaleStatusEvent)
      : [],
  };
}

function normalizeSettings(row) {
  const { _id, ...persisted } = row || {};
  const updatedAtFallback = persisted.updatedAt
    ? toIsoTimestamp(persisted.updatedAt)
    : new Date().toISOString();

  return {
    ...defaultSettings,
    ...persisted,
    taxRate: Number(persisted.taxRate ?? defaultSettings.taxRate),
    lowStockThreshold: Number(persisted.lowStockThreshold ?? defaultSettings.lowStockThreshold),
    notifications: persisted.notifications ?? defaultSettings.notifications,
    autoPrintReceipt: persisted.autoPrintReceipt ?? defaultSettings.autoPrintReceipt,
    enableDiscounts: persisted.enableDiscounts ?? defaultSettings.enableDiscounts,
    requirePinForRefunds: persisted.requirePinForRefunds ?? defaultSettings.requirePinForRefunds,
    showStockWarnings: persisted.showStockWarnings ?? defaultSettings.showStockWarnings,
    salesEmailReports: persisted.salesEmailReports ?? defaultSettings.salesEmailReports,
    dailySummaryRecipientEmail:
      persisted.dailySummaryRecipientEmail ?? defaultSettings.dailySummaryRecipientEmail,
    dailySummaryDeliveryHour: Number(
      persisted.dailySummaryDeliveryHour ?? defaultSettings.dailySummaryDeliveryHour
    ),
    dailySummaryDeliveryMinute: Number(
      persisted.dailySummaryDeliveryMinute ?? defaultSettings.dailySummaryDeliveryMinute
    ),
    dailySummaryLastDigestDate:
      persisted.dailySummaryLastDigestDate ?? defaultSettings.dailySummaryLastDigestDate,
    dailySummaryLastSentAt:
      persisted.dailySummaryLastSentAt ?? defaultSettings.dailySummaryLastSentAt,
    dailySummaryLastStatus:
      persisted.dailySummaryLastStatus ?? defaultSettings.dailySummaryLastStatus,
    dailySummaryLastError:
      persisted.dailySummaryLastError ?? defaultSettings.dailySummaryLastError,
    compactTables: persisted.compactTables ?? defaultSettings.compactTables,
    dashboardAnimations: persisted.dashboardAnimations ?? defaultSettings.dashboardAnimations,
    quickCheckout: persisted.quickCheckout ?? defaultSettings.quickCheckout,
    soundEffects: persisted.soundEffects ?? defaultSettings.soundEffects,
    domain: persisted.domain ?? defaultSettings.domain,
    timeZone: persisted.timeZone ?? defaultSettings.timeZone,
    defaultReportsView: persisted.defaultReportsView ?? defaultSettings.defaultReportsView,
    autoLockMinutes: Number(
      persisted.autoLockMinutes ?? defaultSettings.autoLockMinutes
    ),
    billingPlan: persisted.billingPlan ?? defaultSettings.billingPlan,
    billingProvider: persisted.billingProvider ?? defaultSettings.billingProvider,
    billingContactEmail:
      persisted.billingContactEmail ?? defaultSettings.billingContactEmail,
    billingNextBillingDate:
      persisted.billingNextBillingDate ?? defaultSettings.billingNextBillingDate,
    billingAutoCharge:
      persisted.billingAutoCharge ?? defaultSettings.billingAutoCharge,
    customerDiscountMode:
      persisted.customerDiscountMode ?? defaultSettings.customerDiscountMode,
    defaultCustomerDiscountPct: Number(
      persisted.defaultCustomerDiscountPct ?? defaultSettings.defaultCustomerDiscountPct
    ),
    vipCustomerDiscountPct: Number(
      persisted.vipCustomerDiscountPct ?? defaultSettings.vipCustomerDiscountPct
    ),
    maxAutoDiscountPct: Number(
      persisted.maxAutoDiscountPct ?? defaultSettings.maxAutoDiscountPct
    ),
    aiDiscountSuggestions:
      persisted.aiDiscountSuggestions ?? defaultSettings.aiDiscountSuggestions,
    apiAccessEnabled:
      persisted.apiAccessEnabled ?? defaultSettings.apiAccessEnabled,
    apiEnvironmentLabel:
      persisted.apiEnvironmentLabel ?? defaultSettings.apiEnvironmentLabel,
    updatedAt: updatedAtFallback,
  };
}

async function loadProductDocument(id, session = null) {
  return applySessionToQuery(
    models.Product.findOne({ id: Number(id) }).lean(),
    session
  );
}

async function loadSaleDocument(id, session = null) {
  return applySessionToQuery(
    models.Sale.findOne({ id: String(id || "").trim() }).lean(),
    session
  );
}

async function ensureCustomerId(name, { session = null } = {}) {
  const normalized = compactLookupText(name, "Walk-in Customer");
  const existing = await applySessionToQuery(
    models.Customer.findOne({
      name: buildExactCaseInsensitiveRegex(normalized),
    }).lean(),
    session
  );

  if (existing) {
    return Number(existing.id);
  }

  const now = new Date();
  const id = await nextSequence(COUNTER_KEYS.customer, { session });

  await models.Customer.create(
    [
      {
        id,
        name: normalized,
        email: "",
        phone: "",
        notes: "",
        isWalkIn: lookupKey(normalized) === "walk-in customer",
        createdAt: now,
        updatedAt: now,
      },
    ],
    { session }
  );

  return id;
}

async function resolveUserIdByIdentity(identity, session = null) {
  const normalized = compactLookupText(identity);
  if (!normalized) return null;

  const byName = await applySessionToQuery(
    models.User.findOne({
      fullName: buildExactCaseInsensitiveRegex(normalized),
    })
      .select({ id: 1 })
      .lean(),
    session
  );

  if (byName) {
    return Number(byName.id);
  }

  const byStaffId = await applySessionToQuery(
    models.User.findOne({
      staffId: buildExactCaseInsensitiveRegex(normalized),
    })
      .select({ id: 1 })
      .lean(),
    session
  );

  return byStaffId ? Number(byStaffId.id) : null;
}

async function insertInventoryMovementDoc(entry, { session = null, product = null } = {}) {
  const movementProduct =
    product || (await loadProductDocument(entry.productId, session));
  const id = await nextSequence(COUNTER_KEYS.inventoryMovement, { session });
  const createdAt = safeDate(entry.createdAt) || new Date();

  await models.InventoryMovement.create(
    [
      {
        id,
        productId: Number(entry.productId),
        productName: String(entry.productName || movementProduct?.name || "").trim(),
        sku: String(entry.sku || movementProduct?.sku || "").trim(),
        movementType: String(entry.movementType || "adjustment").trim() || "adjustment",
        quantityDelta: Number(entry.quantityDelta || 0),
        quantityBefore:
          entry.quantityBefore === null || entry.quantityBefore === undefined
            ? null
            : Number(entry.quantityBefore),
        quantityAfter:
          entry.quantityAfter === null || entry.quantityAfter === undefined
            ? null
            : Number(entry.quantityAfter),
        referenceType: String(entry.referenceType || "").trim(),
        referenceId: String(entry.referenceId || "").trim(),
        note: String(entry.note || "").trim(),
        actorName: String(entry.actorName || "").trim(),
        createdAt,
      },
    ],
    { session }
  );
}

async function getSales() {
  const rows = await models.Sale.find({}).sort({ updatedAt: -1, date: -1, id: -1 }).lean();
  return rows.map(normalizeSale);
}

async function getSaleById(id) {
  const row = await loadSaleDocument(id);
  return normalizeSale(row);
}

async function getNextSaleId() {
  const rows = await models.Sale.find({}).select({ id: 1 }).lean();
  const max = rows.reduce((highest, row) => Math.max(highest, parseNumericFromId(row?.id, 1000)), 1000);
  return `SALE-${max + 1}`;
}

async function getProductById(id) {
  const row = await loadProductDocument(id);
  return normalizeProduct(row);
}

async function getAppSettings() {
  const row = await models.AppSetting.findOne({ id: 1 }).lean();
  return normalizeSettings(row);
}

async function createSale(sale) {
  return withOptionalTransaction(async ({ session }) => {
    const saleId = String(sale.id || (await getNextSaleId())).trim();
    const saleDate = safeDate(sale.date) || new Date();
    const createdAt = safeDate(sale.createdAt) || saleDate;
    const updatedAt = safeDate(sale.updatedAt) || createdAt;
    const customerName = compactLookupText(sale.customer, "Walk-in Customer");
    const customerId =
      sale.customerId === null || sale.customerId === undefined
        ? await ensureCustomerId(customerName, { session })
        : Number(sale.customerId);
    const cashierName = compactLookupText(sale.cashier, "Front Desk");
    const cashierUserId =
      sale.cashierUserId === null || sale.cashierUserId === undefined
        ? await resolveUserIdByIdentity(cashierName, session)
        : Number(sale.cashierUserId);
    const normalizedStatus = String(sale.status || "Pending").trim() || "Pending";
    const requestedItems = Array.isArray(sale.items) ? sale.items : [];
    const productIds = [...new Set(requestedItems.map((item) => Number(item.id)).filter(Number.isFinite))];
    const productRows = await applySessionToQuery(
      models.Product.find({ id: { $in: productIds } }).lean(),
      session
    );
    const productsById = new Map(productRows.map((row) => [Number(row.id), row]));

    const normalizedItems = requestedItems.map((item) => {
      const product = productsById.get(Number(item.id));
      if (!product) {
        throw new Error(`Product not found for item ${item.name}.`);
      }
      const taxProfile = getProductTaxProfile(product);

      return {
        id: Number(product.id),
        name: String(item.name || product.name || "").trim(),
        sku: String(item.sku || product.sku || "").trim(),
        qty: Number(item.qty || 0),
        price: Number(item.price || 0),
        unitCost: Number(item.unitCost || product.unitCost || 0),
        taxClass: normalizeStoredTaxClass(item.taxClass) || taxProfile.taxClass,
        taxCode: String(item.taxCode || taxProfile.taxCode || "").trim(),
        taxLabel: String(item.taxLabel || taxProfile.taxLabel || "").trim(),
        taxRate: Number(item.taxRate ?? taxProfile.taxRate ?? 0),
        isTaxable:
          item.isTaxable === undefined ? Boolean(taxProfile.isTaxable) : Boolean(item.isTaxable),
        discountPercent: Number(item.discountPercent || 0),
        discountAmount: Number(item.discountAmount || 0),
        lineBaseSubtotal: Number(
          item.lineBaseSubtotal ?? Number(item.qty || 0) * Number(item.price || 0)
        ),
        lineSubtotal: Number(
          item.lineSubtotal ??
            Math.max(
              0,
              Number(item.lineBaseSubtotal ?? Number(item.qty || 0) * Number(item.price || 0)) -
                Number(item.discountAmount || 0)
            )
        ),
        taxAmount: Number(item.taxAmount || 0),
        lineTotal: Number(
          item.lineTotal ??
            Math.max(
              0,
              Number(item.lineBaseSubtotal ?? Number(item.qty || 0) * Number(item.price || 0)) -
                Number(item.discountAmount || 0)
            )
        ),
        lineGrossTotal: Number(
          item.lineGrossTotal ??
            Number(
              item.lineTotal ??
                Math.max(
                  0,
                  Number(item.lineBaseSubtotal ?? Number(item.qty || 0) * Number(item.price || 0)) -
                    Number(item.discountAmount || 0)
                )
            ) +
              Number(item.taxAmount || 0)
        ),
        createdAt,
        updatedAt,
      };
    });

    const decremented = [];

    if (normalizedStatus === "Paid") {
      for (const item of normalizedItems) {
        const updatedProduct = await models.Product.findOneAndUpdate(
          {
            id: Number(item.id),
            stock: { $gte: Number(item.qty || 0) },
          },
          {
            $inc: { stock: -Number(item.qty || 0) },
            $set: { updatedAt },
          },
          { new: false, lean: true, session }
        );

        if (!updatedProduct) {
          throw new Error(`Insufficient stock for ${item.name}.`);
        }

        decremented.push({
          productId: Number(item.id),
          qty: Number(item.qty || 0),
          quantityBefore: Number(updatedProduct.stock || 0),
          product: updatedProduct,
        });
      }
    }

    await models.Sale.create(
      [
        {
          id: saleId,
          preDiscountSubtotal: Number(sale.preDiscountSubtotal || 0),
          discount: Number(sale.discount || 0),
          subtotal: Number(sale.subtotal || 0),
          tax: Number(sale.tax || 0),
          total: Number(sale.total || 0),
          cashierUserId:
            cashierUserId === null || cashierUserId === undefined ? null : Number(cashierUserId),
          cashier: cashierName,
          customerId,
          customer: customerName,
          customerDiscountPercent: Number(sale.customerDiscountPercent || 0),
          customerLoyaltyTier: String(sale.customerLoyaltyTier || "").trim(),
          customerLoyaltyNumber: String(sale.customerLoyaltyNumber || "").trim(),
          status: normalizedStatus,
          channel: String(sale.channel || "In-Store").trim() || "In-Store",
          paymentMethod: String(sale.paymentMethod || "Card").trim() || "Card",
          date: saleDate,
          createdAt,
          updatedAt,
          items: normalizedItems,
          refund: {
            reason: "",
            note: "",
            refundedAt: null,
            refundedByUserId: null,
            refundedByName: "",
            approvalPinVerified: false,
          },
          refundRequest: {
            status: "None",
            reason: "",
            note: "",
            incidentReport: "",
            customerStatement: "",
            requestedAt: null,
            requestedByUserId: null,
            requestedByName: "",
            reviewedAt: null,
            reviewedByUserId: null,
            reviewedByName: "",
            decisionNote: "",
            approvalPinVerified: false,
          },
          statusHistory: [
            {
              fromStatus: "Created",
              toStatus: normalizedStatus,
              reason: "",
              note: "Sale recorded.",
              actorUserId:
                cashierUserId === null || cashierUserId === undefined ? null : Number(cashierUserId),
              actorName: cashierName,
              approvalPinVerified: false,
              createdAt: updatedAt,
            },
          ],
        },
      ],
      { session }
    );

    await ensureCounterAtLeast(COUNTER_KEYS.sale, parseNumericFromId(saleId, 1000), { session });

    if (normalizedStatus === "Paid") {
      for (const item of normalizedItems) {
        const decrementEntry = decremented.find(
          (entry) => Number(entry.productId) === Number(item.id)
        );
        const quantityBefore = Number(decrementEntry?.quantityBefore || 0);
        const quantityAfter = quantityBefore - Number(item.qty || 0);

        await insertInventoryMovementDoc(
          {
            productId: Number(item.id),
            productName: item.name,
            sku: item.sku,
            movementType: "sale",
            quantityDelta: -Number(item.qty || 0),
            quantityBefore,
            quantityAfter,
            referenceType: "sale",
            referenceId: saleId,
            note: `Sale recorded for ${String(item.name || "product").trim()}`,
            actorName: cashierName,
            createdAt: saleDate,
          },
          {
            session,
            product: decrementEntry?.product || null,
          }
        );
      }
    }

    const created = await loadSaleDocument(saleId, session);
    return normalizeSale(created);
  });
}

async function updateSaleStatus(id, nextStatus, options = {}) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadSaleDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeSale(existingRow);
    const currentStatus = String(existing.status || "Pending").trim();
    const normalizedNextStatus = String(nextStatus || currentStatus).trim();
    const nextUpdatedAt = safeDate(options.updatedAt) || new Date();
    const actorName = String(options.actorName || existing.cashier || "Front Desk").trim();
    const actorUserId =
      options.actorUserId === null || options.actorUserId === undefined
        ? null
        : Number(options.actorUserId);
    const reason = String(options.reason || "").trim();
    const note = String(options.note || "").trim();
    const approvalPinVerified = Boolean(options.approvalPinVerified);

    if (currentStatus === normalizedNextStatus) {
      return existing;
    }

    if (currentStatus !== "Paid" && normalizedNextStatus === "Paid") {
      for (const item of existing.items || []) {
        const updatedProduct = await models.Product.findOneAndUpdate(
          {
            id: Number(item.id),
            stock: { $gte: Number(item.qty || 0) },
          },
          {
            $inc: { stock: -Number(item.qty || 0) },
            $set: { updatedAt: nextUpdatedAt },
          },
          { new: false, lean: true, session }
        );

        if (!updatedProduct) {
          throw new Error(`Insufficient stock for ${item.name}.`);
        }

        const quantityBefore = Number(updatedProduct.stock || 0);
        const quantityAfter = quantityBefore - Number(item.qty || 0);

        await insertInventoryMovementDoc(
          {
            productId: Number(item.id),
            productName: item.name,
            sku: item.sku,
            movementType: "sale_capture",
            quantityDelta: -Number(item.qty || 0),
            quantityBefore,
            quantityAfter,
            referenceType: "sale",
            referenceId: String(existing.id || "").trim(),
            note:
              note ||
              `Order completed for ${String(item.name || "product").trim()}`,
            actorName,
            createdAt: nextUpdatedAt,
          },
          {
            session,
            product: updatedProduct,
          }
        );
      }
    }

    if (currentStatus === "Paid" && normalizedNextStatus !== "Paid") {
      for (const item of existing.items || []) {
        const updatedProduct = await models.Product.findOneAndUpdate(
          { id: Number(item.id) },
          {
            $inc: { stock: Number(item.qty || 0) },
            $set: { updatedAt: nextUpdatedAt },
          },
          { new: false, lean: true, session }
        );

        if (!updatedProduct) {
          throw new Error(`Product not found for item ${item.name}.`);
        }

        const quantityBefore = Number(updatedProduct.stock || 0);
        const quantityAfter = quantityBefore + Number(item.qty || 0);

        await insertInventoryMovementDoc(
          {
            productId: Number(item.id),
            productName: item.name,
            sku: item.sku,
            movementType:
              normalizedNextStatus === "Refunded" ? "sale_refund" : "sale_reversal",
            quantityDelta: Number(item.qty || 0),
            quantityBefore,
            quantityAfter,
            referenceType: "sale",
            referenceId: String(existing.id || "").trim(),
            note:
              normalizedNextStatus === "Refunded"
                ? note ||
                  reason ||
                  `Order refunded for ${String(item.name || "product").trim()}`
                : note || `Order reversed for ${String(item.name || "product").trim()}`,
            actorName,
            createdAt: nextUpdatedAt,
          },
          {
            session,
            product: updatedProduct,
          }
        );
      }
    }

    const saleUpdate = {
      $set: {
        status: normalizedNextStatus,
        updatedAt: nextUpdatedAt,
      },
      $push: {
        statusHistory: {
          fromStatus: currentStatus,
          toStatus: normalizedNextStatus,
          reason,
          note,
          actorUserId,
          actorName,
          approvalPinVerified,
          createdAt: nextUpdatedAt,
        },
      },
    };

    if (normalizedNextStatus === "Refunded") {
      saleUpdate.$set.refund = {
        reason,
        note,
        refundedAt: nextUpdatedAt,
        refundedByUserId: actorUserId,
        refundedByName: actorName,
        approvalPinVerified,
      };
    }

    if (options.refundRequestPatch) {
      const currentRefundRequest = normalizeSaleRefundRequest(existingRow.refundRequest);
      const nextRefundRequest = {
        ...currentRefundRequest,
        ...options.refundRequestPatch,
      };

      saleUpdate.$set.refundRequest = {
        status: String(nextRefundRequest.status || "None").trim() || "None",
        reason: String(nextRefundRequest.reason || "").trim(),
        note: String(nextRefundRequest.note || "").trim(),
        incidentReport: String(nextRefundRequest.incidentReport || "").trim(),
        customerStatement: String(nextRefundRequest.customerStatement || "").trim(),
        requestedAt: safeDate(nextRefundRequest.requestedAt),
        requestedByUserId:
          nextRefundRequest.requestedByUserId === null || nextRefundRequest.requestedByUserId === undefined
            ? null
            : Number(nextRefundRequest.requestedByUserId),
        requestedByName: String(nextRefundRequest.requestedByName || "").trim(),
        reviewedAt: safeDate(nextRefundRequest.reviewedAt),
        reviewedByUserId:
          nextRefundRequest.reviewedByUserId === null || nextRefundRequest.reviewedByUserId === undefined
            ? null
            : Number(nextRefundRequest.reviewedByUserId),
        reviewedByName: String(nextRefundRequest.reviewedByName || "").trim(),
        decisionNote: String(nextRefundRequest.decisionNote || "").trim(),
        approvalPinVerified: Boolean(nextRefundRequest.approvalPinVerified),
      };
    }

    await models.Sale.updateOne(
      { id: String(existing.id || "").trim() },
      saleUpdate,
      { session }
    );

    const updated = await loadSaleDocument(existing.id, session);
    return normalizeSale(updated);
  });
}

async function updateRefundRequest(id, patch = {}) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadSaleDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeSale(existingRow);
    const currentRefundRequest = normalizeSaleRefundRequest(existingRow.refundRequest);
    const nextUpdatedAt = safeDate(patch.updatedAt) || new Date();
    const nextRefundRequest = {
      ...currentRefundRequest,
      ...patch,
    };

    await models.Sale.updateOne(
      { id: String(existing.id || "").trim() },
      {
        $set: {
          updatedAt: nextUpdatedAt,
          refundRequest: {
            status: String(nextRefundRequest.status || "None").trim() || "None",
            reason: String(nextRefundRequest.reason || "").trim(),
            note: String(nextRefundRequest.note || "").trim(),
            incidentReport: String(nextRefundRequest.incidentReport || "").trim(),
            customerStatement: String(nextRefundRequest.customerStatement || "").trim(),
            requestedAt: safeDate(nextRefundRequest.requestedAt),
            requestedByUserId:
              nextRefundRequest.requestedByUserId === null || nextRefundRequest.requestedByUserId === undefined
                ? null
                : Number(nextRefundRequest.requestedByUserId),
            requestedByName: String(nextRefundRequest.requestedByName || "").trim(),
            reviewedAt: safeDate(nextRefundRequest.reviewedAt),
            reviewedByUserId:
              nextRefundRequest.reviewedByUserId === null || nextRefundRequest.reviewedByUserId === undefined
                ? null
                : Number(nextRefundRequest.reviewedByUserId),
            reviewedByName: String(nextRefundRequest.reviewedByName || "").trim(),
            decisionNote: String(nextRefundRequest.decisionNote || "").trim(),
            approvalPinVerified: Boolean(nextRefundRequest.approvalPinVerified),
          },
        },
      },
      { session }
    );

    const updated = await loadSaleDocument(existing.id, session);
    return normalizeSale(updated);
  });
}

module.exports = {
  createSale,
  getAppSettings,
  getNextSaleId,
  getProductById,
  getSaleById,
  getSales,
  updateRefundRequest,
  updateSaleStatus,
};
