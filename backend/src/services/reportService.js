const crypto = require("crypto");
const analyticsService = require("./analyticsService");
const copilotService = require("./copilotService");
const machineLearningService = require("./machineLearningService");
const auditLogService = require("./auditLogService");
const notificationReceiptRepository = require("../data/repositories/notificationReceiptRepository");
const reportRepository = require("../data/repositories/reportRepository");
const systemRepository = require("../data/repositories/systemRepository");
const systemService = require("./systemService");
const {
  validateNotificationAcknowledgementPayload,
  validateMachineForecastQuery,
  validateOwnerAssistantPayload,
  validateReportRange,
} = require("../validation/reportValidators");

function mapDashboardStatusTrend(items = []) {
  return items.map((item) => ({
    label: item.label,
    time: item.label,
    paidRevenue: item.paidRevenue,
    pendingRevenue: item.pendingRevenue,
    declinedRevenue: item.declinedRevenue,
    totalRevenue: item.totalRevenue,
    totalOrders: item.totalOrders,
    paidRate: item.totalOrders ? (item.paidOrders / item.totalOrders) * 100 : 0,
    atRiskRevenue: Number(item.pendingRevenue || 0) + Number(item.declinedRevenue || 0),
  }));
}

function mapDashboardRevenueTrend(items = []) {
  return items.map((item) => ({
    label: item.label,
    time: item.label,
    revenue: item.revenue,
    orders: item.orders,
    averageOrderValue: item.averageOrderValue,
  }));
}

function escapeCsvCell(value) {
  const normalized = String(value ?? "");
  return `"${normalized.replace(/"/g, '""')}"`;
}

async function loadAnalyticsContext() {
  return analyticsService.getAnalyticsContextAsync();
}

function toIsoTimestamp(value, fallback = new Date()) {
  const date = new Date(value || fallback);
  if (Number.isNaN(date.getTime())) {
    return new Date(fallback).toISOString();
  }

  return date.toISOString();
}

function buildOperationalHealthSnapshot({
  generatedAt,
  warningCount = 0,
  criticalCount = 0,
  warnings = [],
} = {}) {
  const generatedIso = toIsoTimestamp(generatedAt);
  const generatedDate = new Date(generatedIso);
  const dataAgeMinutes = Math.max(
    0,
    Math.floor((Date.now() - generatedDate.getTime()) / 60000)
  );
  const warningTotal = Math.max(0, Number(warningCount || 0));
  const criticalTotal = Math.max(0, Number(criticalCount || 0));
  const warningPreview = Array.isArray(warnings) ? warnings.filter(Boolean).slice(0, 2) : [];

  let status = "fresh";
  let tone = "success";
  let label = "Fresh";

  if (dataAgeMinutes > 180) {
    status = "delayed";
    tone = "danger";
    label = "Delayed";
  } else if (dataAgeMinutes > 45) {
    status = "monitor";
    tone = "warning";
    label = "Monitor";
  }

  if (criticalTotal > 0) {
    status = "critical";
    tone = "danger";
    label = "Action needed";
  } else if (warningTotal > 0 && status === "fresh") {
    status = "warning";
    tone = "warning";
    label = "Needs review";
  }

  const freshnessMessage =
    dataAgeMinutes <= 0
      ? "Data is synced to the current workspace snapshot."
      : `Data is ${dataAgeMinutes} minute${dataAgeMinutes === 1 ? "" : "s"} old.`;
  const warningMessage = warningPreview.length ? ` ${warningPreview.join(" ")}` : "";
  const message =
    criticalTotal > 0
      ? `${criticalTotal} critical owner signal${criticalTotal === 1 ? "" : "s"} are active. ${freshnessMessage}${warningMessage}`.trim()
      : warningTotal > 0
      ? `${warningTotal} watch signal${warningTotal === 1 ? "" : "s"} are active. ${freshnessMessage}${warningMessage}`.trim()
      : freshnessMessage;

  return {
    status,
    tone,
    label,
    generatedAt: generatedIso,
    dataAgeMinutes,
    warningCount: warningTotal,
    criticalCount: criticalTotal,
    message,
  };
}

function buildNotificationItem({
  id,
  tone = "neutral",
  category = "Operations",
  title,
  detail,
  generatedAt,
  action,
  priority = 0,
}) {
  return {
    id,
    tone,
    category,
    title,
    detail,
    generatedAt: toIsoTimestamp(generatedAt),
    action,
    priority,
  };
}

function buildNotificationSignature(item = {}) {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        id: String(item.id || "").trim(),
        tone: String(item.tone || "").trim(),
        category: String(item.category || "").trim(),
        title: String(item.title || "").trim(),
        detail: String(item.detail || "").trim(),
        action: {
          label: String(item?.action?.label || "").trim(),
          path: String(item?.action?.path || "").trim(),
          focus: String(item?.action?.focus || "").trim(),
          note: String(item?.action?.note || "").trim(),
        },
      })
    )
    .digest("hex");
}

function decorateNotificationsWithReceipts(items = [], receipts = []) {
  const receiptMap = new Map(
    receipts
      .filter(Boolean)
      .map((receipt) => [String(receipt.notificationId || "").trim(), receipt])
  );

  return items.map((item) => {
    const signature = buildNotificationSignature(item);
    const receipt = receiptMap.get(String(item.id || "").trim());
    const acknowledged = Boolean(receipt && receipt.signature === signature);

    return {
      ...item,
      acknowledged,
      acknowledgedAt: acknowledged ? String(receipt?.acknowledgedAt || "").trim() : "",
    };
  });
}

async function getReportsOverview() {
  const context = await loadAnalyticsContext();
  return {
    overview: analyticsService.getOverviewMetrics(context),
    categoryValue: analyticsService.getCategoryValueData(context),
    recentSales: analyticsService.getNormalizedSales(context).slice(-10).reverse(),
  };
}

async function getDashboardSummary() {
  const context = await loadAnalyticsContext();
  const overview = analyticsService.getOverviewMetrics(context);
  const inventorySignals = analyticsService.getInventorySignals(context);
  const inventoryIntel = analyticsService.getInventoryIntelligence(context);
  const monthlyReports = analyticsService.getReportsDataset("monthly", context);
  const dashboardDecisionModel = analyticsService.getDashboardDecisionModel(context);
  const businessPulse = analyticsService.getBusinessPulse("monthly", context);
  const topCashiers = analyticsService.getTopCashiers(3, context);
  const paymentMethodBreakdown = analyticsService.getPaymentMethodBreakdown(context);
  const channelBreakdown = analyticsService.getChannelBreakdown(context);
  const tradingWindows = analyticsService.getDaypartPerformance(context);
  const mlForecast = machineLearningService.getOperationalModelOutputs(
    {
      range: "daily",
      horizon: 14,
      limit: 6,
    },
    context
  );
  const normalizedSales = analyticsService.getNormalizedSales(context);
  const pendingRefundRequestCount = normalizedSales.filter(
    (sale) => String(sale?.refundRequest?.status || "").trim() === "Pending"
  ).length;
  const mlWarnings = [
    ...(Array.isArray(mlForecast?.integrity?.warnings) ? mlForecast.integrity.warnings : []),
    ...(Array.isArray(mlForecast?.dataFoundation?.qualityWarnings)
      ? mlForecast.dataFoundation.qualityWarnings
      : []),
  ].filter(Boolean);
  const unsettledExposure =
    Number(overview.pendingRevenue || 0) + Number(overview.declinedRevenue || 0);
  const criticalSignals = [
    pendingRefundRequestCount > 0,
    Number(inventorySignals.outOfStockCount || 0) > 0,
    Number(overview.pendingOrders || 0) > 0 && unsettledExposure > 0,
  ].filter(Boolean).length;
  const warningSignals =
    [
      Number(inventorySignals.lowStockCount || 0) > 0,
      Number(inventoryIntel?.summary?.dormantStockCount || 0) > 0,
      Number(overview.pendingOrders || 0) > 0,
      Array.isArray(dashboardDecisionModel?.smartAlerts) &&
        dashboardDecisionModel.smartAlerts.length > 0,
    ].filter(Boolean).length + mlWarnings.length;
  const operationalHealth = buildOperationalHealthSnapshot({
    generatedAt: context.latestObservedAt || new Date(),
    warningCount: warningSignals,
    criticalCount: criticalSignals,
    warnings: mlWarnings,
  });

  return {
    generatedAt: operationalHealth.generatedAt,
    operationalHealth,
    stats: {
      totalRevenue: overview.totalRevenue,
      capturedRevenue: overview.paidRevenue,
      ordersCount: overview.totalOrders,
      avgOrderValue: overview.averageOrderValue,
      paidRate: overview.paidRate,
      paidOrders: overview.paidOrders,
      pendingOrders: overview.pendingOrders,
      declinedOrders: overview.declinedOrders,
      pendingRevenue: overview.pendingRevenue,
      declinedRevenue: overview.declinedRevenue,
      inventoryValue: overview.totalInventoryValue,
      lowStockCount: inventorySignals.lowStockCount,
      outOfStockCount: inventorySignals.outOfStockCount,
      healthScore: Math.min(
        98,
        Math.max(
          24,
          Math.round(
            100 -
              inventorySignals.outOfStockCount * 12 -
              inventorySignals.lowStockCount * 3 -
              Number(inventoryIntel?.summary?.dormantStockCount || 0) * 2
          )
        )
      ),
    },
    revenueTrend: mapDashboardRevenueTrend(analyticsService.getSalesTrend("daily", context)),
    statusTrend: mapDashboardStatusTrend(analyticsService.getStatusTrend("daily", context)),
    lowStock: inventorySignals.lowStockProducts.map((item) => ({
      name: item.name,
      stock: Number(item.stock || 0),
      category: item.category || "General",
    })),
    recentSales: analyticsService.getNormalizedSales(context).slice(-5).reverse(),
    businessPulse,
    forecast: monthlyReports.forecast,
    categoryBreakdown: monthlyReports.categoryBreakdown.slice(0, 6),
    topProducts: monthlyReports.topProducts.slice(0, 5),
    topCashiers,
    paymentMethodBreakdown,
    channelBreakdown,
    tradingWindows,
    dailyBriefing: dashboardDecisionModel.dailyBriefing,
    whatChanged: dashboardDecisionModel.whatChanged,
    smartAlerts: dashboardDecisionModel.smartAlerts,
    recommendations: dashboardDecisionModel.recommendations,
    customerIntelligence: dashboardDecisionModel.customerIntelligence,
    staffingIntelligence: dashboardDecisionModel.staffingIntelligence,
    forecastSignals: dashboardDecisionModel.forecastSignals,
    scenarioDefaults: dashboardDecisionModel.scenarioDefaults,
    mlForecast,
  };
}

async function getOrderAnalytics(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  const reports = analyticsService.getReportsDataset(range, context);

  return {
    range,
    summary: reports.summary,
    trend: reports.trend,
    statusTrend: reports.statusTrend,
    statusBreakdown: analyticsService.getStatusBreakdown(context),
    revenueByStatus: analyticsService.getRevenueByStatus(context),
    paymentMethodBreakdown: analyticsService.getPaymentMethodBreakdown(context),
    channelBreakdown: analyticsService.getChannelBreakdown(context),
    daypartPerformance: reports.daypartPerformance,
    pulse: analyticsService.getBusinessPulse(range, context),
    recentOrders: analyticsService.getNormalizedSales(context).slice(-10).reverse(),
    topCashiers: analyticsService.getTopCashiers(5, context),
  };
}

async function getBusinessPulse(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  return {
    range,
    signals: analyticsService.getBusinessPulse(range, context),
  };
}

async function getInventoryIntelligence() {
  const context = await loadAnalyticsContext();
  return analyticsService.getInventoryIntelligence(context);
}

async function getCustomerAnalytics(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  return analyticsService.getCustomersDataset(range, context);
}

async function getSupplierAnalytics(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  return analyticsService.getSuppliersDataset(range, context);
}

async function buildNotificationFeed() {
  const context = await loadAnalyticsContext();
  const [securityTelemetry, aiStatus] = await Promise.all([
    systemRepository.getSecurityTelemetry(),
    Promise.resolve(systemService.getAiStatus()),
  ]);
  const overview = analyticsService.getOverviewMetrics(context);
  const inventorySignals = analyticsService.getInventorySignals(context);
  const inventoryIntel = analyticsService.getInventoryIntelligence(context);
  const supplierIntel = analyticsService.getSuppliersDataset("monthly", context);
  const dashboardDecisionModel = analyticsService.getDashboardDecisionModel(context);
  const mlForecast = machineLearningService.getOperationalModelOutputs(
    {
      range: "daily",
      horizon: 14,
      limit: 4,
    },
    context
  );
  const latestObservedAt = context.latestObservedAt || new Date();
  const pendingExposure = Number(overview.pendingRevenue || 0) + Number(overview.declinedRevenue || 0);
  const openCommitmentValue = Number(supplierIntel?.summary?.openCommitmentValue || 0);
  const modelWarnings = [
    ...(Array.isArray(mlForecast?.integrity?.warnings) ? mlForecast.integrity.warnings : []),
    ...(Array.isArray(mlForecast?.dataFoundation?.qualityWarnings)
      ? mlForecast.dataFoundation.qualityWarnings
      : []),
  ].filter(Boolean);
  const modelConfidence = Number(
    mlForecast?.modelSummary?.confidenceScore || mlForecast?.overview?.confidenceScore || 0
  );
  const supplierSignals = Array.isArray(mlForecast?.supplierSignals) ? mlForecast.supplierSignals : [];
  const leadSupplierSignal = [...supplierSignals].sort(
    (left, right) => Number(right?.weightedRiskScore || 0) - Number(left?.weightedRiskScore || 0)
  )[0] || null;
  const riskAlerts = Array.isArray(dashboardDecisionModel?.smartAlerts)
    ? dashboardDecisionModel.smartAlerts
    : [];
  const normalizedSales = analyticsService.getNormalizedSales(context);
  const pendingRefundRequests = normalizedSales.filter(
    (sale) => String(sale?.refundRequest?.status || "").trim() === "Pending"
  );
  const items = [];

  if (
    String(securityTelemetry?.posture || "").trim() !== "stable" ||
    Number(securityTelemetry?.failedLogins24h || 0) > 0 ||
    Number(securityTelemetry?.concurrentSessions24h || 0) > 0
  ) {
    const securityTone =
      securityTelemetry?.posture === "attention" ? "danger" : "warning";
    items.push(
      buildNotificationItem({
        id: "security-posture-watch",
        tone: securityTone,
        category: "Security",
        title:
          securityTelemetry?.posture === "attention"
            ? "Workspace security posture needs review"
            : "Session telemetry is seeing review-worthy movement",
        detail:
          `${Number(securityTelemetry?.highRiskSessions || 0)} high-risk session` +
          `${Number(securityTelemetry?.highRiskSessions || 0) === 1 ? "" : "s"}, ` +
          `${Number(securityTelemetry?.failedLogins24h || 0)} failed login` +
          `${Number(securityTelemetry?.failedLogins24h || 0) === 1 ? "" : "s"}, and ` +
          `${Number(securityTelemetry?.concurrentSessions24h || 0)} concurrent-session alert` +
          `${Number(securityTelemetry?.concurrentSessions24h || 0) === 1 ? "" : "s"} were recorded in the last 24 hours.`,
        generatedAt: securityTelemetry?.lastSecurityEventAt || latestObservedAt,
        action: {
          label: "Open settings",
          path: "/settings",
          note: "Runtime security posture, session risk, and deployment controls are visible in the settings control plane.",
        },
        priority: securityTone === "danger" ? 100 : 82,
      })
    );
  }

  if (inventorySignals.lowStockCount > 0) {
    const leadSku = inventorySignals.lowStockProducts?.[0];
    items.push(
      buildNotificationItem({
        id: "low-stock-watch",
        tone: "warning",
        category: "Inventory",
        title: `${inventorySignals.lowStockCount} low-stock SKUs need action`,
        detail: leadSku
          ? `${leadSku.name} is leading the pressure queue with ${leadSku.stock} units left on hand.`
          : "Low-stock lines are active in the current catalog.",
        generatedAt: latestObservedAt,
        action: {
          label: "Open inventory",
          path: "/pos-dashboard",
          focus: "inventory-directory",
          note: "Inventory pressure is visible in the current stock directory.",
        },
        priority: 88,
      })
    );
  }

  if (pendingExposure > 0 || Number(overview.pendingOrders || 0) > 0) {
    items.push(
      buildNotificationItem({
        id: "order-capture-watch",
        tone: "danger",
        category: "Orders",
        title: `${Number(overview.pendingOrders || 0)} orders still need clean capture`,
        detail: `${pendingExposure.toFixed(2)} in unsettled order value is still sitting outside captured revenue.`,
        generatedAt: latestObservedAt,
        action: {
          label: "Open orders",
          path: "/orders",
          focus: "orders-ledger",
          note: "Order settlement and capture issues need review in the live ledger.",
        },
        priority: 96,
      })
    );
  }

  if (pendingRefundRequests.length > 0) {
    const leadRequest = pendingRefundRequests[0];
    items.push(
      buildNotificationItem({
        id: "refund-approval-queue",
        tone: "warning",
        category: "Refunds",
        title: `${pendingRefundRequests.length} refund request${pendingRefundRequests.length === 1 ? "" : "s"} waiting for owner approval`,
        detail: `Order ${leadRequest?.id || "n/a"} is sitting in the approval queue for ${Number(leadRequest?.total || 0).toFixed(2)} with the reason "${String(leadRequest?.refundRequest?.reason || "").trim() || "operator review"}".`,
        generatedAt:
          leadRequest?.refundRequest?.requestedAt ||
          leadRequest?.updatedAt ||
          latestObservedAt,
        action: {
          label: "Open refunds",
          path: "/orders/refunds",
          note: "Review staff-submitted incident reports before any refund is approved.",
        },
        priority: 92,
      })
    );
  }

  if (openCommitmentValue > 0) {
    items.push(
      buildNotificationItem({
        id: "supplier-commitment-watch",
        tone: leadSupplierSignal ? "warning" : "neutral",
        category: "Suppliers",
        title: "Supplier commitments are still open",
        detail: leadSupplierSignal
          ? `${openCommitmentValue.toFixed(2)} is still waiting to land, and ${leadSupplierSignal.supplier} is carrying the heaviest supplier-risk signal.`
          : `${openCommitmentValue.toFixed(2)} is still waiting to land across live purchase orders.`,
        generatedAt: latestObservedAt,
        action: {
          label: "Open suppliers",
          path: "/suppliers",
          note: "Supplier pressure is active across the current procurement view.",
        },
        priority: leadSupplierSignal ? 84 : 72,
      })
    );
  }

  if (Number(inventoryIntel?.summary?.dormantStockCount || 0) > 0) {
    items.push(
      buildNotificationItem({
        id: "dormant-capital-watch",
        tone: "warning",
        category: "Inventory",
        title: "Dormant inventory is tying up capital",
        detail: `${Number(inventoryIntel.summary.dormantStockCount || 0)} lines are moving slowly and should be reviewed against active demand.`,
        generatedAt: latestObservedAt,
        action: {
          label: "Open planner",
          path: "/pos-dashboard",
          focus: "inventory-reorder",
          note: "Dormant capital and reorder pressure are visible in the planner.",
        },
        priority: 70,
      })
    );
  }

  if (
    modelWarnings.length ||
    modelConfidence < 50 ||
    String(aiStatus?.status || "").trim() !== "grounded-external-hybrid-live"
  ) {
    const modelTone =
      modelWarnings.length || modelConfidence < 40 ? "warning" : "neutral";
    items.push(
      buildNotificationItem({
        id: "forecast-integrity-watch",
        tone: modelTone,
        category: "Forecast",
        title: modelWarnings.length
          ? "Forecast advisories are active"
          : "Forecast posture is available but still modestly confident",
        detail: modelWarnings.length
          ? modelWarnings.slice(0, 2).join(" ")
          : `Forecast confidence is ${modelConfidence.toFixed(0)} out of 100, so replenishment decisions should stay grounded in the live order and supplier lanes.`,
        generatedAt: latestObservedAt,
        action: {
          label: "Open reports",
          path: "/reports",
          note: "Forecast integrity, planning tables, and operational model posture are visible in reports.",
        },
        priority: modelWarnings.length ? 78 : 62,
      })
    );
  }

  if (!items.length) {
    const primaryAlert = riskAlerts[0];
    items.push(
      buildNotificationItem({
        id: "workspace-stable",
        tone: "success",
        category: "Operations",
        title: "Workspace is stable",
        detail:
          primaryAlert?.summary ||
          "No critical inventory, settlement, supplier, security, or forecast alerts are active right now.",
        generatedAt: latestObservedAt,
        action: {
          label: "Open dashboard",
          path: "/",
          note: "Use the dashboard to review the current owner brief and live business posture.",
        },
        priority: 10,
      })
    );
  }

  return {
    generatedAt: toIsoTimestamp(latestObservedAt),
    items: items
      .sort((left, right) => {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }

        return String(right.generatedAt || "").localeCompare(String(left.generatedAt || ""));
      })
      .slice(0, 8),
  };
}

async function getNotifications(actor = null) {
  const feed = await buildNotificationFeed();
  const visibleItems = feed.items.map(({ priority, ...item }) => item);
  const receipts = actor?.id
    ? await notificationReceiptRepository.listNotificationReceiptsByUserId(
        actor.id,
        visibleItems.map((item) => item.id)
      )
    : [];
  const decoratedItems = decorateNotificationsWithReceipts(visibleItems, receipts);

  return {
    generatedAt: feed.generatedAt,
    unreadCount: decoratedItems.filter((item) => !item.acknowledged).length,
    items: decoratedItems,
  };
}

async function acknowledgeNotifications(payload = {}, actor = null) {
  const { ids, markAll } = validateNotificationAcknowledgementPayload(payload);

  if (!actor?.id) {
    throw new Error("A valid authenticated actor is required to acknowledge notifications.");
  }

  const feed = await buildNotificationFeed();
  const visibleItems = feed.items.map(({ priority, ...item }) => item);
  const targetItems = markAll
    ? visibleItems
    : visibleItems.filter((item) => ids.includes(String(item.id || "").trim()));

  if (!targetItems.length) {
    return getNotifications(actor);
  }

  const acknowledgedAt = new Date().toISOString();

  await notificationReceiptRepository.acknowledgeNotifications(
    actor.id,
    targetItems.map((item) => ({
      notificationId: item.id,
      signature: buildNotificationSignature(item),
      acknowledgedAt,
    }))
  );

  await auditLogService.recordAuditEvent({
    actor,
    action: "report.notifications_acknowledged",
    entityType: "WorkspaceNotification",
    entityId: markAll ? "all" : targetItems.map((item) => item.id).join(","),
    details: {
      markAll,
      count: targetItems.length,
      notificationIds: targetItems.map((item) => item.id),
    },
  });

  return getNotifications(actor);
}

async function getOwnerAssistantBootstrap() {
  return copilotService.getOwnerAssistantBootstrap();
}

async function getOwnerAssistantReply(payload) {
  const { question, history } = validateOwnerAssistantPayload(payload);
  return copilotService.getOwnerAssistantReply(question, history);
}

async function getMachineForecast(query = {}) {
  const context = await loadAnalyticsContext();
  const options = validateMachineForecastQuery(query, "daily");
  return machineLearningService.getOperationalModelOutputs(options, context);
}

async function getAdvancedReports(query = {}) {
  const range = validateReportRange(query.range, "monthly");
  const context = await loadAnalyticsContext();
  const options = validateMachineForecastQuery(query, range);
  const reports = analyticsService.getReportsDataset(range, context);
  const mlForecast = machineLearningService.getOperationalModelOutputs(options, context);
  const normalizedSales = analyticsService.getNormalizedSales(context);
  const pendingRefundRequestCount = normalizedSales.filter(
    (sale) => String(sale?.refundRequest?.status || "").trim() === "Pending"
  ).length;
  const summary = reports?.summary || {};
  const unsettledExposure =
    Number(summary.pendingRevenue || 0) + Number(summary.declinedRevenue || 0);
  const mlWarnings = [
    ...(Array.isArray(mlForecast?.integrity?.warnings) ? mlForecast.integrity.warnings : []),
    ...(Array.isArray(mlForecast?.dataFoundation?.qualityWarnings)
      ? mlForecast.dataFoundation.qualityWarnings
      : []),
  ].filter(Boolean);
  const criticalSignals = [
    pendingRefundRequestCount > 0,
    Number(summary.outOfStockCount || 0) > 0,
    Number(summary.pendingOrders || 0) > 0 && unsettledExposure > 0,
  ].filter(Boolean).length;
  const warningSignals =
    [
      Number(summary.lowStockCount || 0) > 0,
      Number(summary.pendingOrders || 0) > 0,
      Number(summary.declinedOrders || 0) > 0,
    ].filter(Boolean).length + mlWarnings.length;
  const operationalHealth = buildOperationalHealthSnapshot({
    generatedAt: reports?.generatedAt || context.latestObservedAt || new Date(),
    warningCount: warningSignals,
    criticalCount: criticalSignals,
    warnings: mlWarnings,
  });

  return {
    ...reports,
    operationalHealth,
    mlForecast,
  };
}

async function exportReportsCsv() {
  const sales = await reportRepository.getSales();
  const rows = [
    ["Order ID", "Customer", "Cashier", "Status", "Channel", "Payment Method", "Total", "Date"].join(","),
    ...sales.map((sale) =>
      [
        escapeCsvCell(sale.id || ""),
        escapeCsvCell(sale.customer || "Walk-in Customer"),
        escapeCsvCell(sale.cashier || "Front Desk"),
        escapeCsvCell(sale.status || "Paid"),
        escapeCsvCell(sale.channel || "In-Store"),
        escapeCsvCell(sale.paymentMethod || "Card"),
        Number(sale.total || 0),
        escapeCsvCell(sale.date || ""),
      ].join(",")
    ),
  ];

  return {
    filename: "afrospice-reports.csv",
    contentType: "text/csv",
    body: rows.join("\n"),
  };
}

module.exports = {
  getReportsOverview,
  getDashboardSummary,
  getOrderAnalytics,
  getBusinessPulse,
  getInventoryIntelligence,
  getCustomerAnalytics,
  getSupplierAnalytics,
  getNotifications,
  acknowledgeNotifications,
  getOwnerAssistantBootstrap,
  getOwnerAssistantReply,
  getMachineForecast,
  getAdvancedReports,
  exportReportsCsv,
};
