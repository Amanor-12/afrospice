const AppError = require("../errors/AppError");
const auditLogService = require("./auditLogService");
const settingsRepository = require("../data/repositories/settingsRepository");
const emailLogRepository = require("../data/repositories/emailLogRepository");
const models = require("../data/models");
const { sendEmail, getMailTransportStatus } = require("./emailService");
const { executeWithRetry } = require("./retryService");
const { buildSimplePdfBuffer } = require("../utils/pdfDocument");

const DEFAULT_TIME_ZONE = "America/Toronto";
const DAILY_SUMMARY_TYPE = "daily-summary";
const TEST_EMAIL_TYPE = "test";
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 10 * 1000;
const FALLBACK_LOW_STOCK_THRESHOLD = 5;

function readRetryDelayMs() {
  const parsed = Number(process.env.DAILY_SUMMARY_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RETRY_DELAY_MS;
  }

  return Math.max(1000, Math.min(120000, Math.round(parsed)));
}

function normalizeTimeZone(value) {
  const candidate = String(value || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;

  try {
    Intl.DateTimeFormat("en-CA", {
      timeZone: candidate,
      year: "numeric",
    }).format(new Date());

    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function getTimeZoneParts(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  const year = Number(parts.year || 0);
  const month = Number(parts.month || 0);
  const day = Number(parts.day || 0);
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`,
  };
}

function formatMoney(value, currency = "CAD") {
  const code = String(currency || "CAD").trim().toUpperCase() || "CAD";
  const locale = code === "CAD" ? "en-CA" : "en-US";

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-CA").format(Number(value || 0));
}

function formatDeliveryLabel(hour, minute, timeZone) {
  const normalizedHour = Math.max(0, Math.min(23, Number(hour || 0)));
  const normalizedMinute = Math.max(0, Math.min(59, Number(minute || 0)));
  const period = normalizedHour >= 12 ? "PM" : "AM";
  const twelveHour = normalizedHour % 12 || 12;

  return `${twelveHour}:${String(normalizedMinute).padStart(2, "0")} ${period} ${normalizeTimeZone(
    timeZone
  )}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateText(value, maxLength = 240) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function resolveRecipientEmail(settings = {}, recipientOverride = "") {
  return String(
    recipientOverride ||
      settings.dailySummaryRecipientEmail ||
      settings.supportEmail ||
      settings.billingContactEmail ||
      ""
  )
    .trim()
    .toLowerCase();
}

function normalizeSaleStatus(status) {
  const value = String(status || "Pending").trim().toLowerCase();
  if (["paid", "completed", "success"].includes(value)) return "Paid";
  if (["pending", "processing", "awaiting"].includes(value)) return "Pending";
  if (["declined", "failed", "cancelled", "canceled"].includes(value)) return "Declined";
  if (["refunded", "refund"].includes(value)) return "Refunded";
  return "Pending";
}

function normalizeProduct(row) {
  return {
    id: Number(row?.id || 0),
    name: String(row?.name || "").trim(),
    sku: String(row?.sku || "").trim(),
    supplier: String(row?.supplier || "General Supplier").trim() || "General Supplier",
    stock: Number(row?.stock || 0),
    unitCost: Number(row?.unitCost || 0),
    category: String(row?.category || "General").trim() || "General",
  };
}

function normalizeSaleItem(row) {
  return {
    id: Number(row?.id || 0),
    sku: String(row?.sku || "").trim(),
    name: String(row?.name || "").trim(),
    qty: Math.max(0, Number(row?.qty || 0)),
    unitCost: Number(row?.unitCost || 0),
    lineTotal: Number(
      row?.lineTotal ??
        row?.lineGrossTotal ??
        row?.lineSubtotal ??
        Number(row?.price || 0) * Number(row?.qty || 0)
    ),
  };
}

function normalizeSale(row) {
  return {
    id: String(row?.id || "").trim(),
    status: normalizeSaleStatus(row?.status),
    total: Number(row?.total || 0),
    customer: String(row?.customer || "Walk-in Customer").trim() || "Walk-in Customer",
    cashier: String(row?.cashier || "Front Desk").trim() || "Front Desk",
    paymentMethod: String(row?.paymentMethod || "Card").trim() || "Card",
    channel: String(row?.channel || "In-Store").trim() || "In-Store",
    refundedByName: String(row?.refund?.refundedByName || "").trim(),
    refundReason: String(row?.refund?.reason || "").trim(),
    refundNote: String(row?.refund?.note || "").trim(),
    items: Array.isArray(row?.items) ? row.items.map(normalizeSaleItem) : [],
    date: row?.date ? new Date(row.date) : row?.createdAt ? new Date(row.createdAt) : new Date(),
  };
}

function getLowStockThreshold(settings = {}) {
  const threshold = Number(settings.lowStockThreshold);
  if (Number.isFinite(threshold) && threshold >= 0) {
    return Math.max(0, Math.round(threshold));
  }

  return FALLBACK_LOW_STOCK_THRESHOLD;
}

function buildStatusBreakdown(sales, currency) {
  const breakdownMap = new Map();

  sales.forEach((sale) => {
    const current = breakdownMap.get(sale.status) || {
      label: sale.status,
      count: 0,
      revenue: 0,
    };

    current.count += 1;
    if (sale.status === "Paid") {
      current.revenue += Number(sale.total || 0);
    }
    breakdownMap.set(sale.status, current);
  });

  return ["Paid", "Pending", "Declined", "Refunded"]
    .map((status) => breakdownMap.get(status))
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      revenueLabel: formatMoney(entry.revenue, currency),
    }));
}

function buildTopProducts(paidSales, currency) {
  const products = new Map();

  paidSales.forEach((sale) => {
    sale.items.forEach((item) => {
      const key = item.sku || item.name || String(item.id || "");
      if (!key) {
        return;
      }

      const current = products.get(key) || {
        name: item.name || item.sku || "Unknown Product",
        sku: item.sku || "",
        qty: 0,
        revenue: 0,
        estimatedMargin: 0,
      };

      current.qty += Number(item.qty || 0);
      current.revenue += Number(item.lineTotal || 0);
      current.estimatedMargin +=
        Number(item.lineTotal || 0) - Number(item.unitCost || 0) * Number(item.qty || 0);
      products.set(key, current);
    });
  });

  return Array.from(products.values())
    .sort((left, right) => {
      if (right.revenue !== left.revenue) {
        return right.revenue - left.revenue;
      }

      return right.qty - left.qty;
    })
    .slice(0, 5)
    .map((item) => ({
      ...item,
      revenueLabel: formatMoney(item.revenue, currency),
      estimatedMarginLabel: formatMoney(item.estimatedMargin, currency),
    }));
}

function buildCashierPerformance(paidSales, currency) {
  const cashiers = new Map();

  paidSales.forEach((sale) => {
    const key = sale.cashier || "Front Desk";
    const current = cashiers.get(key) || {
      name: key,
      orders: 0,
      revenue: 0,
    };

    current.orders += 1;
    current.revenue += Number(sale.total || 0);
    cashiers.set(key, current);
  });

  return Array.from(cashiers.values())
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 4)
    .map((item) => ({
      ...item,
      revenueLabel: formatMoney(item.revenue, currency),
    }));
}

function buildRefundWatch(refundedSales, currency) {
  return refundedSales
    .slice()
    .sort((left, right) => right.total - left.total)
    .slice(0, 5)
    .map((sale) => ({
      id: sale.id,
      customer: sale.customer,
      total: sale.total,
      totalLabel: formatMoney(sale.total, currency),
      reason: sale.refundReason || sale.refundNote || "Refund recorded",
      refundedByName: sale.refundedByName || "Operations Team",
    }));
}

function buildSupplierPressure(products) {
  const supplierPressure = new Map();

  products.forEach((product) => {
    const key = product.supplier || "General Supplier";
    const current = supplierPressure.get(key) || {
      supplier: key,
      lowStockCount: 0,
      outOfStockCount: 0,
      exposedSkus: [],
    };

    if (product.stock <= 0) {
      current.outOfStockCount += 1;
      current.exposedSkus.push(product.name);
    } else if (product.stock > 0) {
      current.lowStockCount += 1;
      current.exposedSkus.push(product.name);
    }

    supplierPressure.set(key, current);
  });

  return Array.from(supplierPressure.values())
    .sort((left, right) => {
      const rightRisk = right.outOfStockCount * 10 + right.lowStockCount;
      const leftRisk = left.outOfStockCount * 10 + left.lowStockCount;
      return rightRisk - leftRisk;
    })
    .slice(0, 5)
    .map((item) => ({
      ...item,
      exposedSkus: item.exposedSkus.slice(0, 3),
    }));
}

function buildRecommendationList({ summary, lowStockItems, outOfStockItems }) {
  const items = [];

  if (outOfStockItems.length > 0) {
    items.push({
      label: "Recover stock breaks",
      detail: `Raise replacement purchase orders for ${outOfStockItems
        .slice(0, 3)
        .map((item) => item.name)
        .join(", ")} before the next open shift.`,
    });
  }

  if (lowStockItems.length > 0) {
    items.push({
      label: "Move the reorder queue",
      detail: `${lowStockItems.length} live SKU${
        lowStockItems.length === 1 ? "" : "s"
      } are below the current stock threshold and should be staged for replenishment today.`,
    });
  }

  if (summary.pendingOrders > 0 || summary.declinedOrders > 0) {
    items.push({
      label: "Tighten revenue capture",
      detail: `${summary.pendingOrders} pending and ${summary.declinedOrders} declined orders need review to recover exposed revenue.`,
    });
  }

  if (summary.totalOrders === 0) {
    items.push({
      label: "Quiet trading window",
      detail: "No new orders landed in the last 24 hours. Review store traffic, promotions, and opening execution before the next trade window.",
    });
  }

  if (items.length === 0) {
    items.push({
      label: "Maintain current operating posture",
      detail: "Sales converted cleanly and no urgent inventory breaks were detected across the monitored catalogue.",
    });
  }

  return items;
}

function summarizeDailySummaryTransportHealth(transport = {}, logs = []) {
  const recentLogs = Array.isArray(logs) ? logs : [];
  const recentSuccessCount = recentLogs.filter((entry) => entry?.status === "success").length;
  const recentFailureCount = recentLogs.filter((entry) => entry?.status === "failed").length;
  const lastAttempt = recentLogs[0] || null;
  const lastSuccess = recentLogs.find((entry) => entry?.status === "success") || null;
  const lastFailure = recentLogs.find((entry) => entry?.status === "failed") || null;
  const providerLabel = String(transport?.provider || "email").trim().toUpperCase() || "EMAIL";

  if (!transport?.configured) {
    const missing = Array.isArray(transport?.missing) ? transport.missing.filter(Boolean) : [];
    return {
      ...transport,
      health: "unavailable",
      message: missing.length
        ? `Setup needed: ${missing.join(", ")}`
        : `${providerLabel} transport is not configured.`,
      recentSuccessCount,
      recentFailureCount,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: "",
    };
  }

  if (!recentLogs.length) {
    return {
      ...transport,
      health: "ready",
      message: `${providerLabel} is configured and ready for the first daily summary delivery.`,
      recentSuccessCount,
      recentFailureCount,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: "",
    };
  }

  if (recentFailureCount > 0 && recentSuccessCount === 0) {
    return {
      ...transport,
      health: "degraded",
      message:
        String(lastFailure?.errorMessage || "").trim() ||
        `${providerLabel} is configured, but recent daily summary deliveries are failing.`,
      recentSuccessCount,
      recentFailureCount,
      lastAttemptAt: lastAttempt?.timestamp || null,
      lastSuccessAt: null,
      lastFailureAt: lastFailure?.timestamp || null,
      lastError: String(lastFailure?.errorMessage || "").trim(),
    };
  }

  if (recentFailureCount > 0) {
    return {
      ...transport,
      health: "warning",
      message: `${providerLabel} is live, but ${recentFailureCount} recent daily summary deliveries need review.`,
      recentSuccessCount,
      recentFailureCount,
      lastAttemptAt: lastAttempt?.timestamp || null,
      lastSuccessAt: lastSuccess?.timestamp || null,
      lastFailureAt: lastFailure?.timestamp || null,
      lastError: String(lastFailure?.errorMessage || "").trim(),
    };
  }

  return {
    ...transport,
    health: "healthy",
    message: `${providerLabel} is live and recent daily summary deliveries are healthy.`,
    recentSuccessCount,
    recentFailureCount,
    lastAttemptAt: lastAttempt?.timestamp || null,
    lastSuccessAt: lastSuccess?.timestamp || null,
    lastFailureAt: null,
    lastError: "",
  };
}

function buildNarrative(summary) {
  if (summary.outOfStockCount > 0) {
    return {
      headline: `${formatNumber(summary.outOfStockCount)} catalogue line${
        summary.outOfStockCount === 1 ? " is" : "s are"
      } fully out of stock.`,
      summary:
        "The operating priority today is restoring stock coverage before more demand is lost at the shelf or terminal.",
      nextMove: "Raise supplier action on the out-of-stock queue first, then clear low-stock exposure behind it.",
    };
  }

  if (summary.lowStockCount > 0) {
    return {
      headline: `${formatNumber(summary.lowStockCount)} SKU${
        summary.lowStockCount === 1 ? " is" : "s are"
      } running low.`,
      summary:
        "Inventory pressure is visible, but still recoverable without a full stock break if replenishment starts early.",
      nextMove: "Confirm reorder commitments and move supplier follow-ups into the first operational block.",
    };
  }

  if (summary.pendingOrders > 0 || summary.declinedOrders > 0) {
    return {
      headline: "Cash quality needs attention.",
      summary:
        "Revenue is moving, but part of the order stream is still exposed in pending or declined states that should be cleaned up quickly.",
      nextMove: "Review payment failures, retry customer follow-ups, and close unresolved order states.",
    };
  }

  if (summary.paidOrders > 0) {
    return {
      headline: `${formatMoney(summary.totalSales, summary.currency)} settled in the last 24 hours.`,
      summary:
        "Trading is active and the revenue stream is converting without immediate operational stress signals.",
      nextMove: "Keep the floor stocked, protect margin, and use the current cadence to prepare the next restock window.",
    };
  }

  return {
    headline: "No material trading activity was recorded in the last 24 hours.",
    summary:
      "The system is online, but the current window is commercially quiet and should be treated as a readiness check rather than a sales pulse.",
    nextMove: "Review staffing posture, store presentation, and campaign readiness before the next demand block.",
  };
}

async function buildDailySummaryDataset(settings = {}) {
  const now = new Date();
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const threshold = getLowStockThreshold(settings);

  const [salesRows, productRows] = await Promise.all([
    models.Sale.find({
      date: {
        $gte: windowStart,
        $lte: windowEnd,
      },
    })
      .sort({ date: -1 })
      .lean(),
    models.Product.find({}).sort({ stock: 1, name: 1 }).lean(),
  ]);

  const sales = salesRows.map(normalizeSale);
  const products = productRows.map(normalizeProduct);
  const paidSales = sales.filter((sale) => sale.status === "Paid");
  const pendingSales = sales.filter((sale) => sale.status === "Pending");
  const declinedSales = sales.filter((sale) => sale.status === "Declined");
  const refundedSales = sales.filter((sale) => sale.status === "Refunded");
  const lowStockItems = products.filter((item) => item.stock > 0 && item.stock <= threshold);
  const outOfStockItems = products.filter((item) => item.stock <= 0);
  const totalSales = paidSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const refundedSalesValue = refundedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const totalOrders = sales.length;
  const averageOrderValue = paidSales.length > 0 ? totalSales / paidSales.length : 0;
  const summary = {
    totalSales,
    totalOrders,
    paidOrders: paidSales.length,
    pendingOrders: pendingSales.length,
    declinedOrders: declinedSales.length,
    refundedOrders: refundedSales.length,
    refundedSalesValue,
    averageOrderValue,
    lowStockCount: lowStockItems.length,
    outOfStockCount: outOfStockItems.length,
    lowStockThreshold: threshold,
    currency: settings.currency || "CAD",
  };

  return {
    generatedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    summary,
    sales,
    lowStockItems,
    outOfStockItems,
    statusBreakdown: buildStatusBreakdown(sales, summary.currency),
    topProducts: buildTopProducts(paidSales, summary.currency),
    cashierPerformance: buildCashierPerformance(paidSales, summary.currency),
    refundWatch: buildRefundWatch(refundedSales, summary.currency),
    supplierPressure: buildSupplierPressure([...outOfStockItems, ...lowStockItems]),
    recommendations: buildRecommendationList({
      summary,
      lowStockItems,
      outOfStockItems,
    }),
    narrative: buildNarrative(summary),
  };
}

function buildMetricCards(dataset) {
  const { summary } = dataset;

  return [
    {
      label: "Captured Revenue",
      value: formatMoney(summary.totalSales, summary.currency),
      note: `${formatNumber(summary.paidOrders)} paid order${
        summary.paidOrders === 1 ? "" : "s"
      } settled in the last 24 hours.`,
    },
    {
      label: "Total Orders",
      value: formatNumber(summary.totalOrders),
      note: `${formatNumber(summary.pendingOrders)} pending, ${formatNumber(
        summary.declinedOrders
      )} declined, ${formatNumber(summary.refundedOrders)} refunded.`,
    },
    {
      label: "Average Order Value",
      value: formatMoney(summary.averageOrderValue, summary.currency),
      note:
        summary.paidOrders > 0
          ? "Calculated from paid orders in the current delivery window."
          : "No paid orders were captured in the current delivery window.",
    },
    {
      label: "Refund Exposure",
      value: formatMoney(summary.refundedSalesValue, summary.currency),
      note:
        summary.refundedOrders > 0
          ? `${formatNumber(summary.refundedOrders)} refund${
              summary.refundedOrders === 1 ? "" : "s"
            } were recorded in the current delivery window.`
          : "No refunds were recorded in the current delivery window.",
    },
    {
      label: "Low-Stock Queue",
      value: formatNumber(summary.lowStockCount),
      note: `Threshold: ${formatNumber(summary.lowStockThreshold)} units remaining.`,
    },
    {
      label: "Out Of Stock",
      value: formatNumber(summary.outOfStockCount),
      note:
        summary.outOfStockCount > 0
          ? "Immediate replenishment risk is present."
          : "No fully depleted catalogue lines were detected.",
    },
  ];
}

function buildPreviewPayload(settings, dataset, options = {}) {
  const timeZone = normalizeTimeZone(settings.timeZone);
  const nowParts = getTimeZoneParts(new Date(), timeZone);
  const recentEmailLogs = Array.isArray(options.recentEmailLogs) ? options.recentEmailLogs : [];
  const transport = summarizeDailySummaryTransportHealth(getMailTransportStatus(), recentEmailLogs);
  const emailType =
    String(options.type || DAILY_SUMMARY_TYPE).trim().toLowerCase() === TEST_EMAIL_TYPE
      ? TEST_EMAIL_TYPE
      : DAILY_SUMMARY_TYPE;
  const recipientEmail = resolveRecipientEmail(settings, options.recipientOverride);
  const metricCards = buildMetricCards(dataset);

  return {
    generatedAt: dataset.generatedAt,
    digestDate: nowParts.dateKey,
    emailType,
    storeName: settings.storeName,
    branchCode: settings.branchCode,
    recipientEmail,
    currency: dataset.summary.currency,
    timeZone,
    deliveryLabel: formatDeliveryLabel(
      settings.dailySummaryDeliveryHour,
      settings.dailySummaryDeliveryMinute,
      timeZone
    ),
    window: {
      label: "Last 24 hours",
      startAt: dataset.windowStart,
      endAt: dataset.windowEnd,
    },
    schedule: {
      enabled: Boolean(settings.salesEmailReports),
      deliveryHour: Number(settings.dailySummaryDeliveryHour || 0),
      deliveryMinute: Number(settings.dailySummaryDeliveryMinute || 0),
      deliveryLabel: formatDeliveryLabel(
        settings.dailySummaryDeliveryHour,
        settings.dailySummaryDeliveryMinute,
        timeZone
      ),
      lastDigestDate: settings.dailySummaryLastDigestDate || "",
      lastSentAt: settings.dailySummaryLastSentAt || "",
      lastStatus: settings.dailySummaryLastStatus || "idle",
      lastError: formatOwnerFacingDeliveryError(settings.dailySummaryLastError || ""),
    },
    transport: transport,
    narrative: dataset.narrative,
    metrics: metricCards,
    overview: dataset.summary,
    sections: {
      lowStockItems: dataset.lowStockItems.slice(0, 6).map((item) => ({
        name: item.name,
        detail: `${formatNumber(item.stock)} units remaining · ${item.supplier}`,
      })),
      outOfStockItems: dataset.outOfStockItems.slice(0, 6).map((item) => ({
        name: item.name,
        detail: `${item.supplier} · ${item.category}`,
      })),
      statusBreakdown: dataset.statusBreakdown,
      topProducts: dataset.topProducts,
      cashierPerformance: dataset.cashierPerformance,
      refundWatch: dataset.refundWatch,
      supplierPressure: dataset.supplierPressure,
      recommendations: dataset.recommendations,
    },
  };
}

function buildEmailSubject(preview) {
  const prefix = preview.emailType === TEST_EMAIL_TYPE ? "Test" : "Daily Summary";
  return `${preview.storeName} ${prefix} • ${preview.digestDate}`;
}

function buildTextList(items = [], formatter) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- No items to report.";
  }

  return items.map((item) => `- ${formatter(item)}`).join("\n");
}

function buildEmailText(preview) {
  const metricLines = buildTextList(
    preview.metrics,
    (item) => `${item.label}: ${item.value} (${item.note})`
  );
  const lowStockLines = buildTextList(
    preview.sections.lowStockItems,
    (item) => `${item.name}: ${item.detail}`
  );
  const outOfStockLines = buildTextList(
    preview.sections.outOfStockItems,
    (item) => `${item.name}: ${item.detail}`
  );
  const statusLines = buildTextList(
    preview.sections.statusBreakdown,
    (item) => `${item.label}: ${item.count} orders${item.revenue ? `, ${item.revenueLabel}` : ""}`
  );
  const topProductLines = buildTextList(
    preview.sections.topProducts,
    (item) =>
      `${item.name}: ${formatNumber(item.qty)} units, ${item.revenueLabel} revenue, ${item.estimatedMarginLabel} est. margin`
  );
  const cashierLines = buildTextList(
    preview.sections.cashierPerformance,
    (item) => `${item.name}: ${formatNumber(item.orders)} paid orders, ${item.revenueLabel} revenue`
  );
  const refundLines = buildTextList(
    preview.sections.refundWatch,
    (item) => `${item.id}: ${item.totalLabel} for ${item.customer} (${item.reason})`
  );
  const supplierLines = buildTextList(
    preview.sections.supplierPressure,
    (item) =>
      `${item.supplier}: ${formatNumber(item.outOfStockCount)} out, ${formatNumber(
        item.lowStockCount
      )} low (${item.exposedSkus.join(", ")})`
  );
  const actionLines = buildTextList(
    preview.sections.recommendations,
    (item) => `${item.label}: ${item.detail}`
  );

  return [
    `${preview.storeName} ${preview.emailType === TEST_EMAIL_TYPE ? "Test " : ""}Daily Summary`,
    `Branch: ${preview.branchCode}`,
    `Recipient: ${preview.recipientEmail}`,
    `Digest date: ${preview.digestDate}`,
    `Window: ${preview.window.label}`,
    `Generated at: ${preview.generatedAt}`,
    "",
    preview.narrative.headline,
    preview.narrative.summary,
    `Next move: ${preview.narrative.nextMove}`,
    "",
    "Key Metrics",
    metricLines,
    "",
    "Order Status Mix",
    statusLines,
    "",
    "Top Products",
    topProductLines,
    "",
    "Cashier Performance",
    cashierLines,
    "",
    "Refund Watch",
    refundLines,
    "",
    "Supplier Pressure",
    supplierLines,
    "",
    "Low Stock",
    lowStockLines,
    "",
    "Out Of Stock",
    outOfStockLines,
    "",
    "Recommended Actions",
    actionLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildHtmlList(items = [], formatter, emptyMessage) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<li>${escapeHtml(emptyMessage)}</li>`;
  }

  return items
    .map((item) => {
      const formatted = formatter(item);
      return `<li><strong>${escapeHtml(formatted.title)}</strong><br />${escapeHtml(
        formatted.detail
      )}</li>`;
    })
    .join("");
}

function buildMetricCardHtml(metrics = []) {
  return metrics
    .map(
      (item) =>
        `<div style="border:1px solid #e2e8f0;border-radius:18px;padding:18px;background:rgba(255,255,255,0.9);">
          <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;">${escapeHtml(
            item.label
          )}</div>
          <div style="margin-top:10px;font-size:28px;font-weight:700;letter-spacing:-0.04em;color:#0f172a;">${escapeHtml(
            item.value
          )}</div>
          <div style="margin-top:10px;font-size:13px;line-height:1.6;color:#475569;">${escapeHtml(
            item.note
          )}</div>
        </div>`
    )
    .join("");
}

function buildBrandLogoHtml() {
  return `<div style="display:flex;align-items:center;gap:12px;">
    <svg width="38" height="28" viewBox="0 0 38 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M5.4 2.5H19.2C20.8 2.5 21.6 4.4 20.5 5.5L16.4 9.6C15.9 10.1 15.2 10.4 14.5 10.4H0.7C-0.9 10.4 -1.7 8.5 -0.6 7.4L3.5 3.3C4 2.8 4.7 2.5 5.4 2.5Z" fill="#78C8FF"/>
      <path d="M17.6 12.3H31.8C33.4 12.3 34.2 14.2 33.1 15.3L28.9 19.5C28.4 20 27.7 20.3 27 20.3H12.9C11.3 20.3 10.5 18.4 11.6 17.3L15.8 13.1C16.3 12.6 16.9 12.3 17.6 12.3Z" fill="#38A8FF"/>
      <path d="M6.6 17.1H20.8C22.4 17.1 23.2 19 22.1 20.1L17.9 24.3C17.4 24.8 16.8 25.1 16.1 25.1H1.9C0.3 25.1 -0.5 23.2 0.6 22.1L4.8 17.9C5.3 17.4 5.9 17.1 6.6 17.1Z" fill="#0F7BFF"/>
    </svg>
    <div>
      <div style="font-size:18px;font-weight:700;letter-spacing:-0.04em;color:#ffffff;">AfroSpice</div>
      <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.72;">Retail Operations</div>
    </div>
  </div>`;
}

function buildEmailHtml(preview) {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#eef2ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
    <div style="max-width:760px;margin:0 auto;padding:28px 18px;">
      <div style="background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid rgba(148,163,184,0.18);box-shadow:0 28px 60px rgba(15,23,42,0.12);">
        <div style="padding:28px 28px 24px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);color:#ffffff;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;">
            ${buildBrandLogoHtml()}
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.78;text-align:right;">${
              preview.emailType === TEST_EMAIL_TYPE ? "Daily Summary Test" : "Daily Summary"
            }</div>
          </div>
          <h1 style="margin:10px 0 8px;font-size:34px;line-height:1.05;letter-spacing:-0.05em;">${escapeHtml(
            preview.storeName
          )}</h1>
          <div style="font-size:14px;opacity:0.88;">Branch ${escapeHtml(
            preview.branchCode
          )} · ${escapeHtml(preview.digestDate)} · ${escapeHtml(preview.window.label)}</div>
        </div>

        <div style="padding:28px;">
          <div style="padding:20px 22px;border-radius:22px;background:linear-gradient(180deg,rgba(248,250,252,0.96) 0%,rgba(255,255,255,0.98) 100%);border:1px solid #e2e8f0;">
            <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;">Operations Brief</div>
            <h2 style="margin:10px 0 10px;font-size:28px;line-height:1.15;letter-spacing:-0.04em;">${escapeHtml(
              preview.narrative.headline
            )}</h2>
            <p style="margin:0 0 10px;font-size:15px;line-height:1.7;color:#334155;">${escapeHtml(
              preview.narrative.summary
            )}</p>
            <p style="margin:0;font-size:14px;line-height:1.65;color:#475569;"><strong>Next move:</strong> ${escapeHtml(
              preview.narrative.nextMove
            )}</p>
          </div>

          <div style="margin-top:22px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;">
            ${buildMetricCardHtml(preview.metrics)}
          </div>

          <div style="margin-top:26px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;">
            <div style="padding:20px;border-radius:22px;border:1px solid #e2e8f0;background:#ffffff;">
              <h3 style="margin:0 0 12px;font-size:18px;letter-spacing:-0.03em;">Low Stock</h3>
              <ul style="margin:0;padding-left:18px;line-height:1.7;color:#334155;">
                ${buildHtmlList(
                  preview.sections.lowStockItems,
                  (item) => ({ title: item.name, detail: item.detail }),
                  "No low-stock SKUs are currently inside the configured threshold."
                )}
              </ul>
            </div>
            <div style="padding:20px;border-radius:22px;border:1px solid #e2e8f0;background:#ffffff;">
              <h3 style="margin:0 0 12px;font-size:18px;letter-spacing:-0.03em;">Out Of Stock</h3>
              <ul style="margin:0;padding-left:18px;line-height:1.7;color:#334155;">
                ${buildHtmlList(
                  preview.sections.outOfStockItems,
                  (item) => ({ title: item.name, detail: item.detail }),
                  "No fully depleted catalogue lines were detected."
                )}
              </ul>
            </div>
          </div>

          <div style="margin-top:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;">
            <div style="padding:20px;border-radius:22px;border:1px solid #e2e8f0;background:#ffffff;">
              <h3 style="margin:0 0 12px;font-size:18px;letter-spacing:-0.03em;">Order Status Mix</h3>
              <ul style="margin:0;padding-left:18px;line-height:1.7;color:#334155;">
                ${buildHtmlList(
                  preview.sections.statusBreakdown,
                  (item) => ({
                    title: item.label,
                    detail: `${formatNumber(item.count)} orders${
                      item.revenue ? ` · ${item.revenueLabel}` : ""
                    }`,
                  }),
                  "No orders were captured in the current reporting window."
                )}
              </ul>
            </div>
            <div style="padding:20px;border-radius:22px;border:1px solid #e2e8f0;background:#ffffff;">
              <h3 style="margin:0 0 12px;font-size:18px;letter-spacing:-0.03em;">Recommended Actions</h3>
              <ul style="margin:0;padding-left:18px;line-height:1.7;color:#334155;">
                ${buildHtmlList(
                  preview.sections.recommendations,
                  (item) => ({ title: item.label, detail: item.detail }),
                  "No immediate actions were generated."
                )}
              </ul>
            </div>
          </div>

          <div style="margin-top:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;">
            <div style="padding:20px;border-radius:22px;border:1px solid #e2e8f0;background:#ffffff;">
              <h3 style="margin:0 0 12px;font-size:18px;letter-spacing:-0.03em;">Top Products</h3>
              <ul style="margin:0;padding-left:18px;line-height:1.7;color:#334155;">
                ${buildHtmlList(
                  preview.sections.topProducts,
                  (item) => ({
                    title: item.name,
                    detail: `${formatNumber(item.qty)} units | ${item.revenueLabel} revenue | ${item.estimatedMarginLabel} est. margin`,
                  }),
                  "No paid item velocity was recorded in the current reporting window."
                )}
              </ul>
            </div>
            <div style="padding:20px;border-radius:22px;border:1px solid #e2e8f0;background:#ffffff;">
              <h3 style="margin:0 0 12px;font-size:18px;letter-spacing:-0.03em;">Cashier Performance</h3>
              <ul style="margin:0;padding-left:18px;line-height:1.7;color:#334155;">
                ${buildHtmlList(
                  preview.sections.cashierPerformance,
                  (item) => ({
                    title: item.name,
                    detail: `${formatNumber(item.orders)} paid orders | ${item.revenueLabel} revenue`,
                  }),
                  "No paid cashier activity was recorded in the current reporting window."
                )}
              </ul>
            </div>
          </div>

          <div style="margin-top:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;">
            <div style="padding:20px;border-radius:22px;border:1px solid #e2e8f0;background:#ffffff;">
              <h3 style="margin:0 0 12px;font-size:18px;letter-spacing:-0.03em;">Refund Watch</h3>
              <ul style="margin:0;padding-left:18px;line-height:1.7;color:#334155;">
                ${buildHtmlList(
                  preview.sections.refundWatch,
                  (item) => ({
                    title: `${item.id} | ${item.totalLabel}`,
                    detail: `${item.customer} | ${item.reason} | processed by ${item.refundedByName}`,
                  }),
                  "No refunds were recorded in the current reporting window."
                )}
              </ul>
            </div>
            <div style="padding:20px;border-radius:22px;border:1px solid #e2e8f0;background:#ffffff;">
              <h3 style="margin:0 0 12px;font-size:18px;letter-spacing:-0.03em;">Supplier Pressure</h3>
              <ul style="margin:0;padding-left:18px;line-height:1.7;color:#334155;">
                ${buildHtmlList(
                  preview.sections.supplierPressure,
                  (item) => ({
                    title: item.supplier,
                    detail: `${formatNumber(item.outOfStockCount)} out | ${formatNumber(item.lowStockCount)} low | ${item.exposedSkus.join(", ")}`,
                  }),
                  "No supplier exposure was detected inside the current stock threshold."
                )}
              </ul>
            </div>
          </div>

          <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.7;color:#64748b;">
            Sent to ${escapeHtml(preview.recipientEmail)} from the AfroSpice operating runtime. Delivery window: ${escapeHtml(
              preview.deliveryLabel
            )}.
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

async function buildDailySummaryPreview(options = {}) {
  const settings = options.settings || (await settingsRepository.getAppSettings());
  const dataset = options.dataset || (await buildDailySummaryDataset(settings));
  const recentEmailLogs =
    options.recentEmailLogs || (await emailLogRepository.listEmailLogs({ limit: 20 }));
  const preview = buildPreviewPayload(settings, dataset, {
    ...options,
    recentEmailLogs,
  });
  const enrichedPreview = {
    ...preview,
    subject: buildEmailSubject(preview),
    text: buildEmailText(preview),
    html: buildEmailHtml(preview),
  };

  return {
    ...enrichedPreview,
    attachments: buildDailySummaryAttachments(enrichedPreview),
  };
}

function buildDailySummaryAttachments(preview) {
  const lines = [
    `Store: ${preview.storeName}`,
    `Branch: ${preview.branchCode}`,
    `Recipient: ${preview.recipientEmail}`,
    `Digest date: ${preview.digestDate}`,
    `Window: ${preview.window.label}`,
    `Generated at: ${preview.generatedAt}`,
    "",
    preview.narrative.headline,
    preview.narrative.summary,
    `Next move: ${preview.narrative.nextMove}`,
    "",
    "Key metrics",
    ...preview.metrics.map((item) => `${item.label}: ${item.value} | ${item.note}`),
    "",
    "Order status mix",
    ...buildPdfList(preview.sections.statusBreakdown, (item) =>
      `${item.label}: ${formatNumber(item.count)} orders${
        item.revenue ? `, ${item.revenueLabel}` : ""
      }`
    ),
    "",
    "Top products",
    ...buildPdfList(preview.sections.topProducts, (item) =>
      `${item.name}: ${formatNumber(item.qty)} units, ${item.revenueLabel} revenue, ${item.estimatedMarginLabel} est. margin`
    ),
    "",
    "Cashier performance",
    ...buildPdfList(preview.sections.cashierPerformance, (item) =>
      `${item.name}: ${formatNumber(item.orders)} paid orders, ${item.revenueLabel} revenue`
    ),
    "",
    "Refund watch",
    ...buildPdfList(preview.sections.refundWatch, (item) =>
      `${item.id}: ${item.totalLabel} for ${item.customer} (${item.reason})`
    ),
    "",
    "Supplier pressure",
    ...buildPdfList(preview.sections.supplierPressure, (item) =>
      `${item.supplier}: ${formatNumber(item.outOfStockCount)} out, ${formatNumber(
        item.lowStockCount
      )} low (${item.exposedSkus.join(", ")})`
    ),
    "",
    "Recommended actions",
    ...buildPdfList(preview.sections.recommendations, (item) => `${item.label}: ${item.detail}`),
  ];

  const content = buildSimplePdfBuffer({
    title: `${preview.storeName} ${preview.emailType === TEST_EMAIL_TYPE ? "Test " : ""}Daily Summary`,
    subtitle: `${preview.digestDate} | ${preview.deliveryLabel} | ${preview.branchCode}`,
    lines,
  });

  return [
    {
      filename: `afrospice-${preview.emailType === TEST_EMAIL_TYPE ? "test-" : ""}daily-summary-${preview.digestDate}.pdf`,
      content,
      contentType: "application/pdf",
    },
  ];
}

function buildPdfList(items = [], formatter) {
  if (!Array.isArray(items) || items.length === 0) {
    return ["No items to report."];
  }

  return items.map((item) => formatter(item));
}

function buildTransportError(status) {
  const missingList = Array.isArray(status?.missing) && status.missing.length ? status.missing : [];
  const suffix = missingList.length
    ? `Missing: ${missingList.join(", ")}.`
    : "SMTP transport is not fully configured.";

  return `Daily summary email transport is not configured. ${suffix}`;
}

function formatOwnerFacingDeliveryError(errorLike, fallback = "") {
  const message = truncateText(errorLike?.message || errorLike || "", 240);

  if (!message) {
    return fallback;
  }

  if (/AuditLog validation failed|actorStaffId/i.test(message)) {
    return "The previous delivery was blocked by an internal automation log issue. That scheduler path has been corrected and the next scheduled run can proceed automatically.";
  }

  if (/ECONN|ETIMEDOUT|ENOTFOUND|socket hang up|network/i.test(message)) {
    return "The daily summary could not reach the email provider. Check the mail transport and network status, then retry the delivery.";
  }

  return message;
}

async function logEmailAttempt({
  actor,
  preview,
  attempt,
  status,
  error = null,
  delivery = null,
  trigger,
}) {
  const provider =
    String(delivery?.provider || "").trim() || String(getMailTransportStatus()?.provider || "smtp").trim();

  return emailLogRepository.createEmailLog({
    userId: actor?.id ?? null,
    recipientEmail: preview.recipientEmail,
    status,
    errorMessage: error ? truncateText(error.message || String(error), 500) : "",
    type: preview.emailType,
    attempt,
    provider: provider || "smtp",
    messageId: delivery?.messageId || "",
    subject: preview.subject,
    digestDate: preview.digestDate,
    trigger: String(trigger || "manual").trim() || "manual",
  });
}

async function sendSummaryEmail({
  actor = null,
  trigger = "manual",
  type = DAILY_SUMMARY_TYPE,
  recipientOverride = "",
} = {}) {
  const settings = await settingsRepository.getAppSettings();
  const normalizedType =
    String(type || DAILY_SUMMARY_TYPE).trim().toLowerCase() === TEST_EMAIL_TYPE
      ? TEST_EMAIL_TYPE
      : DAILY_SUMMARY_TYPE;

  if (trigger === "scheduler" && !settings.salesEmailReports && normalizedType === DAILY_SUMMARY_TYPE) {
    return {
      skipped: true,
      reason: "disabled",
    };
  }

  const preview = await buildDailySummaryPreview({
    settings,
    type: normalizedType,
    recipientOverride,
  });

  if (!preview.recipientEmail) {
    throw new AppError(400, "Daily summary recipient email is not configured.", {
      code: "DAILY_SUMMARY_RECIPIENT_REQUIRED",
    });
  }

  const transportStatus = getMailTransportStatus();
  if (!transportStatus.configured) {
    await settingsRepository.updateAppSettings({
      dailySummaryLastStatus: "error",
      dailySummaryLastError: buildTransportError(transportStatus),
    });

    throw new AppError(503, buildTransportError(transportStatus), {
      code: "DAILY_SUMMARY_EMAIL_NOT_CONFIGURED",
      details: {
        transport: transportStatus,
      },
    });
  }

  await settingsRepository.updateAppSettings({
    dailySummaryLastStatus: "sending",
    dailySummaryLastError: "",
  });

  try {
    const retryResult = await executeWithRetry({
      maxAttempts: MAX_RETRY_ATTEMPTS,
      delayMs: readRetryDelayMs(),
      operation: async ({ attempt }) => {
        try {
          const delivery = await sendEmail({
            to: preview.recipientEmail,
            subject: preview.subject,
            html: preview.html,
            text: preview.text,
            attachments: preview.attachments,
          });

          const emailLog = await logEmailAttempt({
            actor,
            preview,
            attempt,
            status: "success",
            delivery,
            trigger,
          });

          return {
            delivery,
            emailLog,
            attempt,
          };
        } catch (error) {
          await logEmailAttempt({
            actor,
            preview,
            attempt,
            status: "failed",
            error,
            trigger,
          });
          throw error;
        }
      },
    });

    const updatedSettings = await settingsRepository.updateAppSettings({
      ...(normalizedType === DAILY_SUMMARY_TYPE
        ? { dailySummaryLastDigestDate: preview.digestDate }
        : {}),
      dailySummaryLastSentAt: new Date().toISOString(),
      dailySummaryLastStatus: "sent",
      dailySummaryLastError: "",
    });

    await auditLogService.recordAuditEvent({
      actor,
      action:
        normalizedType === TEST_EMAIL_TYPE
          ? "settings.daily_summary_test_sent"
          : trigger === "scheduler"
          ? "settings.daily_summary_sent_scheduled"
          : "settings.daily_summary_sent",
      entityType: "settings",
      entityId: "app_settings:1",
      details: {
        recipientEmail: preview.recipientEmail,
        trigger,
        attempts: retryResult.attempt,
        provider: retryResult.delivery.provider,
        providerMessageId: retryResult.delivery.messageId,
        digestDate: preview.digestDate,
        type: normalizedType,
      },
    });

    return {
      preview,
      delivery: retryResult.delivery,
      settings: updatedSettings,
      emailLog: retryResult.emailLog,
      attempts: retryResult.attempt,
    };
  } catch (error) {
    const ownerFacingError = formatOwnerFacingDeliveryError(error, "Daily summary delivery failed.");
    const updatedSettings = await settingsRepository.updateAppSettings({
      dailySummaryLastStatus: "error",
      dailySummaryLastError: ownerFacingError,
    });

    await auditLogService.recordAuditEvent({
      actor,
      action:
        normalizedType === TEST_EMAIL_TYPE
          ? "settings.daily_summary_test_failed"
          : trigger === "scheduler"
          ? "settings.daily_summary_send_failed_scheduled"
          : "settings.daily_summary_send_failed",
      entityType: "settings",
      entityId: "app_settings:1",
      details: {
        recipientEmail: preview.recipientEmail,
        trigger,
        digestDate: preview.digestDate,
        error: error.message || "Daily summary delivery failed.",
        type: normalizedType,
      },
    });

    error.details = {
      ...(error.details || {}),
      settings: {
        dailySummaryLastDigestDate: updatedSettings.dailySummaryLastDigestDate,
        dailySummaryLastSentAt: updatedSettings.dailySummaryLastSentAt,
        dailySummaryLastStatus: updatedSettings.dailySummaryLastStatus,
        dailySummaryLastError: ownerFacingError,
      },
    };

    throw error;
  }
}

async function getEmailLogs(options = {}) {
  return emailLogRepository.listEmailLogs(options);
}

module.exports = {
  DAILY_SUMMARY_TYPE,
  TEST_EMAIL_TYPE,
  buildDailySummaryPreview,
  sendDailySummaryNow: (options = {}) =>
    sendSummaryEmail({
      ...options,
      type: DAILY_SUMMARY_TYPE,
    }),
  sendTestEmail: (options = {}) =>
    sendSummaryEmail({
      ...options,
      type: TEST_EMAIL_TYPE,
    }),
  getEmailLogs,
};
