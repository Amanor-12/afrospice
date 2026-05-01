const AppError = require("../errors/AppError");
const customerRepository = require("../data/repositories/customerRepository");
const salesRepository = require("../data/repositories/salesRepository");
const settingsRepository = require("../data/repositories/settingsRepository");
const auditLogService = require("./auditLogService");
const customerCommunicationService = require("./customerCommunicationService");
const {
  validateCustomerListQuery,
  validateCustomerPayload,
} = require("../validation/customerValidators");
const { assertCondition } = require("../validation/helpers");

const VIP_ORDER_THRESHOLD = 6;
const VIP_SPEND_THRESHOLD = 350;
const LOYALTY_POINTS_PER_CURRENCY_UNIT = 10;
const LOYALTY_REWARD_STEP_POINTS = 2000;
const LOYALTY_REWARD_STEP_VALUE = 10;

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeSaleStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, " ");
}

function isRecognizedSale(sale = {}) {
  const status = normalizeSaleStatus(sale?.status);
  return ["paid", "completed", "complete", "success", "succeeded"].includes(status);
}

function isRefundedSale(sale = {}) {
  return ["refunded", "refund", "partial refund", "partially refunded"].includes(
    normalizeSaleStatus(sale?.status)
  );
}

function isDeclinedSale(sale = {}) {
  return ["declined", "failed", "voided", "cancelled", "canceled"].includes(
    normalizeSaleStatus(sale?.status)
  );
}

function getSaleTimestamp(sale = {}) {
  const candidate = sale?.date || sale?.createdAt || null;
  return normalizeTimestamp(candidate);
}

function getSaleDate(sale = {}) {
  const timestamp = getSaleTimestamp(sale);
  return timestamp ? new Date(timestamp) : null;
}

function diffInDays(from, to) {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) return null;
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) return null;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

function calculateAverageVisitCadence(sales = []) {
  if (sales.length < 2) return null;

  const ordered = [...sales]
    .map((sale) => getSaleDate(sale))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());

  if (ordered.length < 2) return null;

  let totalGap = 0;
  let comparisons = 0;

  for (let index = 1; index < ordered.length; index += 1) {
    const gap = diffInDays(ordered[index - 1], ordered[index]);
    if (gap === null) continue;
    totalGap += gap;
    comparisons += 1;
  }

  return comparisons ? Number((totalGap / comparisons).toFixed(1)) : null;
}

function getTrailingSales(sales = [], days = 90, anchorDate = new Date()) {
  const threshold = anchorDate.getTime() - days * 86400000;
  return sales.filter((sale) => {
    const saleDate = getSaleDate(sale);
    return saleDate ? saleDate.getTime() >= threshold : false;
  });
}

function buildCustomerNumber(customer) {
  return `AFR-CUS-${String(Math.max(0, Number(customer?.id || 0))).padStart(4, "0")}`;
}

function buildLoyaltyCardNumber(customer, settings = {}) {
  const numericId = Math.max(0, Number(customer?.id || 0));
  const branchToken = String(settings?.branchCode || "AFR")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 8);

  return `${branchToken || "AFR"}-LOY-${String(numericId).padStart(6, "0")}`;
}

function matchesCustomerSale(customer, sale) {
  if (!customer || !sale) return false;

  if (sale.customerId !== null && sale.customerId !== undefined) {
    return Number(sale.customerId) === Number(customer.id);
  }

  return String(sale.customer || "").trim().toLowerCase() === String(customer.name || "").trim().toLowerCase();
}

function determineCustomerStatus(lastPurchaseAt) {
  if (!lastPurchaseAt) return { label: "New", tone: "neutral" };

  const diffInDays = Math.floor((Date.now() - new Date(lastPurchaseAt).getTime()) / 86400000);
  if (!Number.isFinite(diffInDays) || diffInDays < 0) {
    return { label: "Active", tone: "success" };
  }

  if (diffInDays >= 90) return { label: "Dormant", tone: "danger" };
  if (diffInDays >= 45) return { label: "Cooling", tone: "warning" };
  return { label: "Active", tone: "success" };
}

function determineLoyaltyProfile(customer, settings, summary) {
  const defaultDiscountPct = toFiniteNumber(settings?.defaultCustomerDiscountPct, 5);
  const vipDiscountPct = toFiniteNumber(settings?.vipCustomerDiscountPct, 10);
  const discountsEnabled = Boolean(settings?.enableDiscounts);
  const hasContactMethod = Boolean(String(customer?.email || "").trim() || String(customer?.phone || "").trim());
  const hasLoyaltyEnrollment = Boolean(customer?.loyaltyOptIn);
  const qualifiesForVip =
    summary.orderCount >= VIP_ORDER_THRESHOLD || summary.lifetimeSpend >= VIP_SPEND_THRESHOLD;

  if (customer?.isWalkIn) {
    return {
      loyaltyTier: "Walk-in",
      loyaltyStatus: "System profile",
      discountEligible: false,
      discountPercent: 0,
      discountReason: "Walk-in customers do not receive named loyalty discounts.",
    };
  }

  if (!hasLoyaltyEnrollment) {
    return {
      loyaltyTier: "Guest",
      loyaltyStatus: "Enrollment needed",
      discountEligible: false,
      discountPercent: 0,
      discountReason:
        "This customer needs to opt into the loyalty program before member pricing can activate.",
    };
  }

  if (qualifiesForVip) {
    return {
      loyaltyTier: "VIP",
      loyaltyStatus: "Priority account",
      discountEligible: discountsEnabled,
      discountPercent: discountsEnabled ? vipDiscountPct : 0,
      discountReason: discountsEnabled
        ? `${vipDiscountPct}% loyalty pricing is active for this VIP customer.`
        : "Discounts are currently disabled in settings.",
    };
  }

  if (hasContactMethod) {
    return {
      loyaltyTier: "Member",
      loyaltyStatus: "Registered profile",
      discountEligible: discountsEnabled,
      discountPercent: discountsEnabled ? defaultDiscountPct : 0,
      discountReason: discountsEnabled
        ? `${defaultDiscountPct}% loyalty pricing is available for named customer checkouts.`
        : "Discounts are currently disabled in settings.",
    };
  }

  return {
    loyaltyTier: "Member",
    loyaltyStatus: "Contact details needed",
    discountEligible: false,
    discountPercent: 0,
    discountReason: "Add a phone number or email to activate loyalty pricing for this enrolled customer.",
  };
}

function determineCustomerHealth(summary = {}) {
  const daysSinceLastPurchase = summary.daysSinceLastPurchase;
  const trailing90DayOrders = summary.trailing90DayOrders || 0;
  const trailing90DaySpend = summary.trailing90DaySpend || 0;

  if (daysSinceLastPurchase === null) {
    return {
      label: "Newly enrolled",
      tone: "neutral",
      churnRiskLabel: "Unknown",
      engagementSegment: "Prospect",
      nextAction:
        "Drive the first named purchase quickly so the profile starts building repeat behavior.",
    };
  }

  if (daysSinceLastPurchase >= 120) {
    return {
      label: "Recovery needed",
      tone: "danger",
      churnRiskLabel: "High risk",
      engagementSegment: "Lapsed",
      nextAction:
        "Launch a win-back offer or direct outreach before this customer fully churns.",
    };
  }

  if (daysSinceLastPurchase >= 60 || trailing90DayOrders <= 1) {
    return {
      label: "Cooling",
      tone: "warning",
      churnRiskLabel: "Watch closely",
      engagementSegment: "At risk",
      nextAction:
        "Use a targeted offer or follow-up reminder to bring this customer back into rotation.",
    };
  }

  if (trailing90DaySpend >= VIP_SPEND_THRESHOLD || trailing90DayOrders >= 4) {
    return {
      label: "Healthy",
      tone: "success",
      churnRiskLabel: "Low risk",
      engagementSegment: "Growth",
      nextAction:
        "Protect this account with reliable stock availability and premium service at the lane.",
    };
  }

  return {
    label: "Stable",
    tone: "success",
    churnRiskLabel: "Low risk",
    engagementSegment: "Core",
    nextAction:
      "Keep capture data current and surface relevant products during checkout to grow the basket.",
  };
}

function buildLoyaltyIntelligence(customer, summary, loyalty) {
  const recognizedRevenue = summary.lifetimeSpend || 0;
  const pointsEarned = Math.round(recognizedRevenue * LOYALTY_POINTS_PER_CURRENCY_UNIT);
  const availableRewardsCount = Math.floor(pointsEarned / LOYALTY_REWARD_STEP_POINTS);
  const availableRewardValue = Number((availableRewardsCount * LOYALTY_REWARD_STEP_VALUE).toFixed(2));
  const pointsBalance = pointsEarned % LOYALTY_REWARD_STEP_POINTS;
  const pointsToNextReward = Math.max(0, LOYALTY_REWARD_STEP_POINTS - pointsBalance);
  const nextRewardThreshold = pointsEarned + pointsToNextReward;
  const nextRewardProgressPct = Math.min(
    100,
    Number(((pointsBalance / LOYALTY_REWARD_STEP_POINTS) * 100).toFixed(1))
  );
  const nextTierSpendGap = Math.max(0, Number((VIP_SPEND_THRESHOLD - summary.lifetimeSpend).toFixed(2)));
  const nextTierOrderGap = Math.max(0, VIP_ORDER_THRESHOLD - summary.orderCount);
  const health = determineCustomerHealth(summary);
  const offerRecommendation =
    loyalty.loyaltyTier === "VIP"
      ? "Offer early access to premium stock and service recovery before high-value demand leaks away."
      : summary.trailing90DayOrders === 0
      ? "Send a return incentive with a narrow expiration window to reactivate the account."
      : loyalty.discountEligible
      ? "Use basket-building offers on top products instead of broad discounts."
      : "Capture a phone number or email so the loyalty program can activate and future offers can be delivered.";

  return {
    pointsEarned,
    pointsBalance,
    availableRewardsCount,
    availableRewardValue,
    pointsToNextReward,
    nextRewardThreshold,
    nextRewardProgressPct,
    nextTierSpendGap,
    nextTierOrderGap,
    daysSinceLastPurchase: summary.daysSinceLastPurchase,
    visitCadenceDays: summary.visitCadenceDays,
    trailing90DaySpend: summary.trailing90DaySpend,
    trailing90DayOrders: summary.trailing90DayOrders,
    trailing365DaySpend: summary.trailing365DaySpend,
    trailing365DayOrders: summary.trailing365DayOrders,
    refundCount: summary.refundCount,
    refundedSpend: summary.refundedSpend,
    memberHealthLabel: health.label,
    memberHealthTone: health.tone,
    churnRiskLabel: health.churnRiskLabel,
    engagementSegment: health.engagementSegment,
    loyaltyNextAction: health.nextAction,
    offerRecommendation,
  };
}

function buildTopProducts(sales = []) {
  const totals = new Map();

  for (const sale of sales) {
    for (const item of Array.isArray(sale?.items) ? sale.items : []) {
      const key = String(item?.name || "").trim();
      if (!key) continue;

      const existing = totals.get(key) || {
        name: key,
        qty: 0,
        revenue: 0,
      };

      existing.qty += toFiniteNumber(item?.qty);
      existing.revenue += toFiniteNumber(item?.lineGrossTotal ?? item?.lineTotal ?? item?.lineSubtotal);
      totals.set(key, existing);
    }
  }

  return [...totals.values()]
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 5)
    .map((item) => ({
      ...item,
      revenue: Number(item.revenue.toFixed(2)),
    }));
}

function buildMonthlySpend(sales = []) {
  const totals = new Map();

  for (const sale of sales) {
    const saleDate = normalizeTimestamp(sale?.date || sale?.createdAt);
    if (!saleDate) continue;

    const date = new Date(saleDate);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = date.toLocaleString("en-CA", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

    const existing = totals.get(key) || { key, label, revenue: 0, orders: 0 };
    existing.revenue += toFiniteNumber(sale?.total);
    existing.orders += 1;
    totals.set(key, existing);
  }

  return [...totals.values()]
    .sort((left, right) => String(left.key).localeCompare(String(right.key)))
    .slice(-6)
    .map((entry) => ({
      label: entry.label,
      revenue: Number(entry.revenue.toFixed(2)),
      orders: entry.orders,
    }));
}

function buildCustomerSummary(customer, customerSales = []) {
  const sortedSales = [...customerSales]
    .filter((sale) => !isDeclinedSale(sale))
    .sort((left, right) => {
    const leftTime = new Date(left?.date || left?.createdAt || 0).getTime();
    const rightTime = new Date(right?.date || right?.createdAt || 0).getTime();
    return rightTime - leftTime;
  });
  const recognizedSales = sortedSales.filter((sale) => isRecognizedSale(sale) || isRefundedSale(sale));
  const capturedSales = sortedSales.filter((sale) => isRecognizedSale(sale));
  const refundedSales = sortedSales.filter((sale) => isRefundedSale(sale));
  const anchorDate = getSaleDate(sortedSales[0]) || new Date();

  const orderCount = capturedSales.length;
  const lifetimeSpend = Number(
    capturedSales.reduce((sum, sale) => sum + toFiniteNumber(sale?.total), 0).toFixed(2)
  );
  const lifetimeTax = Number(
    capturedSales.reduce((sum, sale) => sum + toFiniteNumber(sale?.tax), 0).toFixed(2)
  );
  const totalUnits = sortedSales.reduce(
    (sum, sale) =>
      sum +
      (Array.isArray(sale?.items)
        ? sale.items.reduce((itemSum, item) => itemSum + toFiniteNumber(item?.qty), 0)
        : 0),
    0
  );
  const averageOrderValue = Number(
    (orderCount ? lifetimeSpend / orderCount : 0).toFixed(2)
  );
  const firstPurchaseAt = normalizeTimestamp(capturedSales[capturedSales.length - 1]?.date);
  const lastPurchaseAt = normalizeTimestamp(capturedSales[0]?.date);
  const trailing90DaySales = getTrailingSales(capturedSales, 90, anchorDate);
  const trailing365DaySales = getTrailingSales(capturedSales, 365, anchorDate);
  const daysSinceLastPurchase = lastPurchaseAt ? diffInDays(new Date(lastPurchaseAt), anchorDate) : null;
  const refundedSpend = Number(
    refundedSales.reduce((sum, sale) => sum + toFiniteNumber(sale?.total), 0).toFixed(2)
  );

  return {
    orderCount,
    lifetimeSpend,
    lifetimeTax,
    totalUnits,
    averageOrderValue,
    firstPurchaseAt,
    lastPurchaseAt,
    daysSinceLastPurchase,
    visitCadenceDays: calculateAverageVisitCadence(capturedSales),
    trailing90DaySpend: Number(
      trailing90DaySales.reduce((sum, sale) => sum + toFiniteNumber(sale?.total), 0).toFixed(2)
    ),
    trailing90DayOrders: trailing90DaySales.length,
    trailing365DaySpend: Number(
      trailing365DaySales.reduce((sum, sale) => sum + toFiniteNumber(sale?.total), 0).toFixed(2)
    ),
    trailing365DayOrders: trailing365DaySales.length,
    refundCount: refundedSales.length,
    refundedSpend,
    recentOrders: sortedSales.slice(0, 8).map((sale) => ({
      id: sale.id,
      date: sale.date,
      status: sale.status,
      total: toFiniteNumber(sale.total),
      paymentMethod: sale.paymentMethod,
      channel: sale.channel,
      itemCount: Array.isArray(sale?.items)
        ? sale.items.reduce((sum, item) => sum + toFiniteNumber(item?.qty), 0)
        : 0,
    })),
    topProducts: buildTopProducts(recognizedSales),
    monthlySpend: buildMonthlySpend(capturedSales),
  };
}

function enrichCustomer(customer, { settings, sales }) {
  const customerSales = sales.filter((sale) => matchesCustomerSale(customer, sale));
  const summary = buildCustomerSummary(customer, customerSales);
  const loyalty = determineLoyaltyProfile(customer, settings, summary);
  const loyaltyIntelligence = buildLoyaltyIntelligence(customer, summary, loyalty);
  const loyaltyCardNumber = customer?.loyaltyOptIn
    ? String(customer?.loyaltyCardNumber || "").trim() || buildLoyaltyCardNumber(customer, settings)
    : "";
  const profileCompletenessPct = Math.round(
    ([
      Boolean(String(customer?.email || "").trim()),
      Boolean(String(customer?.phone || "").trim()),
      Boolean(String(customer?.notes || "").trim()),
      Boolean(customer?.loyaltyOptIn),
    ].filter(Boolean).length /
      4) *
      100
  );
  const status = determineCustomerStatus(summary.lastPurchaseAt);

  return {
    ...customer,
    customerNumber: buildCustomerNumber(customer),
    loyaltyNumber: loyaltyCardNumber || "Not issued",
    loyaltyCardNumber: loyaltyCardNumber || "",
    loyaltyTier: loyalty.loyaltyTier,
    loyaltyStatus: loyalty.loyaltyStatus,
    discountEligible: loyalty.discountEligible,
    discountPercent: loyalty.discountPercent,
    eligibleDiscountPct: loyalty.discountPercent,
    discountReason: loyalty.discountReason,
    loyaltyOptIn: Boolean(customer?.loyaltyOptIn),
    marketingOptIn: Boolean(customer?.marketingOptIn),
    preferredContactMethod: String(customer?.preferredContactMethod || "None").trim() || "None",
    loyaltyEnrolledAt: customer?.loyaltyEnrolledAt || null,
    loyaltyProgramStatus: customer?.loyaltyOptIn
      ? loyalty.discountEligible
        ? loyaltyIntelligence.availableRewardValue > 0
          ? "Rewards available"
          : "Card active"
        : "Card issued"
      : "Not enrolled",
    customerStatus: status.label,
    customerStatusTone: status.tone,
    orderCount: summary.orderCount,
    lifetimeOrders: summary.orderCount,
    lifetimeSpend: summary.lifetimeSpend,
    lifetimeTax: summary.lifetimeTax,
    totalUnitsPurchased: summary.totalUnits,
    averageOrderValue: summary.averageOrderValue,
    firstPurchaseAt: summary.firstPurchaseAt,
    lastPurchaseAt: summary.lastPurchaseAt,
    daysSinceLastPurchase: loyaltyIntelligence.daysSinceLastPurchase,
    visitCadenceDays: loyaltyIntelligence.visitCadenceDays,
    trailing90DaySpend: loyaltyIntelligence.trailing90DaySpend,
    trailing90DayOrders: loyaltyIntelligence.trailing90DayOrders,
    trailing365DaySpend: loyaltyIntelligence.trailing365DaySpend,
    trailing365DayOrders: loyaltyIntelligence.trailing365DayOrders,
    refundCount: loyaltyIntelligence.refundCount,
    refundedSpend: loyaltyIntelligence.refundedSpend,
    loyaltyPointsEarned: loyaltyIntelligence.pointsEarned,
    loyaltyPointsBalance: loyaltyIntelligence.pointsBalance,
    availableRewardsCount: loyaltyIntelligence.availableRewardsCount,
    availableRewardValue: loyaltyIntelligence.availableRewardValue,
    pointsToNextReward: loyaltyIntelligence.pointsToNextReward,
    nextRewardThreshold: loyaltyIntelligence.nextRewardThreshold,
    nextRewardProgressPct: loyaltyIntelligence.nextRewardProgressPct,
    nextTierSpendGap: loyaltyIntelligence.nextTierSpendGap,
    nextTierOrderGap: loyaltyIntelligence.nextTierOrderGap,
    memberHealthLabel: loyaltyIntelligence.memberHealthLabel,
    memberHealthTone: loyaltyIntelligence.memberHealthTone,
    churnRiskLabel: loyaltyIntelligence.churnRiskLabel,
    engagementSegment: loyaltyIntelligence.engagementSegment,
    offerRecommendation: loyaltyIntelligence.offerRecommendation,
    profileCompletenessPct,
    contactCoverage: {
      hasEmail: Boolean(String(customer?.email || "").trim()),
      hasPhone: Boolean(String(customer?.phone || "").trim()),
      hasNotes: Boolean(String(customer?.notes || "").trim()),
    },
    nextBestCustomerAction: customer?.loyaltyOptIn
      ? loyalty.discountEligible
        ? loyaltyIntelligence.loyaltyNextAction
        : "Capture a phone number or email to unlock the discount tied to this loyalty card."
      : "Offer loyalty enrollment so future checkouts can track spend, reward balance, and unlock discounts.",
    recentOrders: summary.recentOrders,
    topProducts: summary.topProducts,
    monthlySpend: summary.monthlySpend,
  };
}

function matchesCustomerSearch(customer, search) {
  if (!search) return true;
  const haystack = [
    customer.name,
    customer.email,
    customer.phone,
    customer.notes,
    customer.customerNumber,
    customer.loyaltyCardNumber,
    customer.loyaltyTier,
    customer.loyaltyProgramStatus,
    customer.preferredContactMethod,
    customer.customerStatus,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function hasContactRoute(customer = {}) {
  return Boolean(String(customer?.email || "").trim() || String(customer?.phone || "").trim());
}

async function getCustomers(query = {}) {
  const filters = validateCustomerListQuery(query);
  const [customers, sales, settings] = await Promise.all([
    customerRepository.getCustomers(),
    salesRepository.getSales(),
    settingsRepository.getAppSettings(),
  ]);

  return customers
    .map((customer) => enrichCustomer(customer, { sales, settings }))
    .filter((customer) => matchesCustomerSearch(customer, filters.search));
}

async function resolveCustomerCheckoutProfile({ customerId = null, customerName = "" } = {}) {
  const normalizedName = String(customerName || "").trim();
  const normalizedPhoneLookup = normalizedName.replace(/\D/g, "");
  if (
    customerId === null &&
    (!normalizedName || normalizedName.toLowerCase() === "walk-in customer")
  ) {
    return null;
  }

  const [customers, sales, settings] = await Promise.all([
    customerRepository.getCustomers(),
    salesRepository.getSales(),
    settingsRepository.getAppSettings(),
  ]);

  const matchedCustomer =
    customers.find((customer) => Number(customer.id) === Number(customerId)) ||
    customers.find(
      (customer) =>
        String(customer?.name || "").trim().toLowerCase() === normalizedName.toLowerCase()
    ) ||
    customers.find(
      (customer) =>
        String(customer?.loyaltyCardNumber || "").trim().toLowerCase() === normalizedName.toLowerCase()
    ) ||
    customers.find(
      (customer) =>
        String(customer?.email || "").trim().toLowerCase() === normalizedName.toLowerCase()
    ) ||
    (normalizedPhoneLookup
      ? customers.find(
          (customer) =>
            String(customer?.phone || "").replace(/\D/g, "") === normalizedPhoneLookup
        )
      : null) ||
    null;

  if (!matchedCustomer) {
    return null;
  }

  return enrichCustomer(matchedCustomer, { sales, settings });
}

async function getCustomerById(id) {
  const [customer, sales, settings, communicationSummary] = await Promise.all([
    customerRepository.getCustomerById(id),
    salesRepository.getSales(),
    settingsRepository.getAppSettings(),
    customerCommunicationService.getCustomerCommunicationSummary(id).catch(() => ({
      logs: [],
      successCount: 0,
      failedCount: 0,
      emailTransport: { configured: false, provider: "smtp", missing: [] },
      smsTransport: { configured: false, provider: "twilio", missing: [] },
    })),
  ]);

  if (!customer) {
    throw new AppError(404, "Customer not found.", {
      code: "CUSTOMER_NOT_FOUND",
    });
  }

  return {
    ...enrichCustomer(customer, { sales, settings }),
    communicationSummary,
    recentCommunications: communicationSummary.logs,
  };
}

async function getCustomerEnrollmentPreview() {
  const [settings, nextCustomerId] = await Promise.all([
    settingsRepository.getAppSettings(),
    customerRepository.getNextCustomerId(),
  ]);

  const previewCustomer = {
    id: nextCustomerId,
    loyaltyOptIn: true,
  };

  return {
    nextCustomerId,
    customerNumber: buildCustomerNumber(previewCustomer),
    loyaltyNumber: buildLoyaltyCardNumber(previewCustomer, settings),
    loyaltyCardNumber: buildLoyaltyCardNumber(previewCustomer, settings),
    defaultDiscountPct: toFiniteNumber(settings?.defaultCustomerDiscountPct, 5),
    vipDiscountPct: toFiniteNumber(settings?.vipCustomerDiscountPct, 10),
    branchCode: String(settings?.branchCode || "AFR").trim() || "AFR",
  };
}

async function createCustomer(payload, actor) {
  const customer = validateCustomerPayload(payload);
  const settings = await settingsRepository.getAppSettings();
  const nextCustomerId = await customerRepository.getNextCustomerId();

  assertCondition(
    customer.name.toLowerCase() !== "walk-in customer",
    "Walk-in Customer is managed by the system and cannot be created manually."
  );
  assertCondition(
    !(await customerRepository.findCustomerByName(customer.name)),
    "A customer with this name already exists."
  );

  const createdCustomer = await customerRepository.createCustomer({
    id: nextCustomerId,
    loyaltyCardNumber: customer.loyaltyOptIn
      ? buildLoyaltyCardNumber({ id: nextCustomerId }, settings)
      : "",
    ...customer,
    loyaltyEnrolledAt: customer.loyaltyOptIn ? new Date().toISOString() : null,
    isWalkIn: false,
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "customer.created",
    entityType: "customer",
    entityId: String(createdCustomer.id),
    details: {
      name: createdCustomer.name,
      email: createdCustomer.email,
      phone: createdCustomer.phone,
      loyaltyOptIn: createdCustomer.loyaltyOptIn,
    },
  });

  const enrichedCustomer = await getCustomerById(createdCustomer.id);
  const welcomeDispatches = await customerCommunicationService.sendCustomerWelcomeMessage({
    customer: enrichedCustomer,
    actor,
    settings,
  });

  return {
    ...(await getCustomerById(createdCustomer.id)),
    communicationSummary: {
      ...(enrichedCustomer.communicationSummary || {}),
      latestDispatches: welcomeDispatches,
    },
  };
}

async function sendCustomerWelcomeDispatch(id, actor) {
  const [customer, settings] = await Promise.all([
    getCustomerById(id),
    settingsRepository.getAppSettings(),
  ]);

  assertCondition(
    !customer.isWalkIn,
    "Walk-in Customer is managed by the system and cannot receive manual loyalty outreach.",
    409
  );

  const latestDispatches = await customerCommunicationService.sendCustomerWelcomeMessage({
    customer,
    actor,
    settings,
  });
  const refreshedSummary = await customerCommunicationService.getCustomerCommunicationSummary(id);

  await auditLogService.recordAuditEvent({
    actor,
    action: "customer.communication.welcome_sent",
    entityType: "customer",
    entityId: String(id),
    details: {
      email: customer.email,
      phone: customer.phone,
      preferredContactMethod: customer.preferredContactMethod,
      marketingOptIn: customer.marketingOptIn,
      loyaltyOptIn: customer.loyaltyOptIn,
      dispatchCount: latestDispatches.length,
    },
  });

  return {
    ...(await getCustomerById(id)),
    communicationSummary: {
      ...refreshedSummary,
      latestDispatches,
    },
    recentCommunications: refreshedSummary.logs,
  };
}

async function updateCustomer(id, payload, actor) {
  const existing = await getCustomerById(id);
  const settings = await settingsRepository.getAppSettings();

  assertCondition(
    !existing.isWalkIn,
    "Walk-in Customer is managed by the system and cannot be edited manually.",
    409
  );

  const customer = validateCustomerPayload({
    ...existing,
    ...(payload || {}),
  });

  const wasEnrolled = Boolean(existing?.loyaltyOptIn);
  const nextEnrollmentTimestamp =
    customer.loyaltyOptIn && !wasEnrolled
      ? new Date().toISOString()
      : customer.loyaltyOptIn
        ? existing?.loyaltyEnrolledAt || new Date().toISOString()
        : null;

  assertCondition(
    !(await customerRepository.findCustomerByName(customer.name, existing.id)),
    "A customer with this name already exists."
  );

  const updatedCustomer = await customerRepository.updateCustomer(existing.id, {
    ...existing,
    ...customer,
    loyaltyCardNumber: customer.loyaltyOptIn
      ? String(existing.loyaltyCardNumber || "").trim() ||
        buildLoyaltyCardNumber({ id: existing.id }, settings)
      : "",
    loyaltyEnrolledAt: nextEnrollmentTimestamp,
  });

  const shouldAutoDispatchWelcome =
    Boolean(updatedCustomer?.loyaltyOptIn) &&
    (
      !wasEnrolled ||
      (!hasContactRoute(existing) && hasContactRoute(updatedCustomer))
    );

  await auditLogService.recordAuditEvent({
    actor,
    action: "customer.updated",
    entityType: "customer",
    entityId: String(updatedCustomer.id),
    details: {
      previousName: existing.name,
      nextName: updatedCustomer.name,
      email: updatedCustomer.email,
      phone: updatedCustomer.phone,
      loyaltyOptIn: updatedCustomer.loyaltyOptIn,
    },
  });

  const refreshedCustomer = await getCustomerById(updatedCustomer.id);

  if (!shouldAutoDispatchWelcome) {
    return refreshedCustomer;
  }

  const latestDispatches = await customerCommunicationService.sendCustomerWelcomeMessage({
    customer: refreshedCustomer,
    actor,
    settings,
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "customer.communication.auto_welcome_sent",
    entityType: "customer",
    entityId: String(updatedCustomer.id),
    details: {
      email: refreshedCustomer.email,
      phone: refreshedCustomer.phone,
      preferredContactMethod: refreshedCustomer.preferredContactMethod,
      marketingOptIn: refreshedCustomer.marketingOptIn,
      loyaltyOptIn: refreshedCustomer.loyaltyOptIn,
      dispatchCount: latestDispatches.length,
      trigger: !wasEnrolled ? "loyalty_enrollment" : "contact_route_added",
    },
  });

  return {
    ...(await getCustomerById(updatedCustomer.id)),
    communicationSummary: {
      ...(refreshedCustomer.communicationSummary || {}),
      latestDispatches,
    },
  };
}

async function deleteCustomer(id, actor) {
  const existing = await getCustomerById(id);

  assertCondition(
    !existing.isWalkIn,
    "Walk-in Customer is managed by the system and cannot be deleted.",
    409
  );

  try {
    const deletedCustomer = await customerRepository.deleteCustomer(existing.id);

    await auditLogService.recordAuditEvent({
      actor,
      action: "customer.deleted",
      entityType: "customer",
      entityId: String(deletedCustomer.id),
      details: {
        name: deletedCustomer.name,
      },
    });

    return deletedCustomer;
  } catch (error) {
    if (!/referenced by existing records|cannot be deleted/i.test(String(error?.message || ""))) {
      throw error;
    }

    throw new AppError(
      409,
      "This customer cannot be deleted because it is referenced by existing business records.",
      {
        code: "CUSTOMER_DELETE_CONFLICT",
      }
    );
  }
}

module.exports = {
  getCustomers,
  resolveCustomerCheckoutProfile,
  getCustomerById,
  getCustomerEnrollmentPreview,
  createCustomer,
  sendCustomerWelcomeDispatch,
  updateCustomer,
  deleteCustomer,
};
