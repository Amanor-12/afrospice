const bcrypt = require("bcryptjs");
const AppError = require("../errors/AppError");
const salesRepository = require("../data/repositories/salesRepository");
const auditLogService = require("./auditLogService");
const customerService = require("./customerService");
const authRepository = require("../data/repositories/authRepository");
const { assertRoleAllowed } = require("./accessControlService");
const { calculateTaxAmount } = require("../tax/ontarioProductTax");
const {
  validateCreateSalePayload,
  validateSaleStatusPayload,
  validateRefundRequestPayload,
  validateRefundDecisionPayload,
} = require("../validation/salesValidators");

function normalizeStatus(status) {
  const value = String(status || "Paid").trim().toLowerCase();
  if (["paid", "completed", "success"].includes(value)) return "Paid";
  if (["pending", "processing", "awaiting"].includes(value)) return "Pending";
  if (["declined", "failed", "cancelled", "canceled"].includes(value)) return "Declined";
  if (["refunded", "refund"].includes(value)) return "Refunded";
  return "Paid";
}

function resolveActorName(actor, fallback = "Front Desk") {
  return String(actor?.fullName || actor?.staffId || fallback).trim() || fallback;
}

async function verifyRefundApprovalPin({ approvalPin, actor, settings }) {
  if (!settings?.requirePinForRefunds) {
    return false;
  }

  if (!approvalPin) {
    throw new AppError(400, "Approval PIN is required for refunds.", {
      code: "REFUND_PIN_REQUIRED",
    });
  }

  const actorUser = await authRepository.getUserById(actor?.id);
  if (!actorUser?.pin) {
    throw new AppError(403, "Your account does not have a valid approval PIN.", {
      code: "REFUND_PIN_NOT_AVAILABLE",
    });
  }

  const pinMatches = await bcrypt.compare(String(approvalPin), String(actorUser.pin || ""));
  if (!pinMatches) {
    throw new AppError(403, "Approval PIN is incorrect.", {
      code: "REFUND_PIN_INVALID",
    });
  }

  return true;
}

function computeSaleTotals(items, customerDiscountPercent = 0) {
  const normalizedDiscountPercent = Math.max(0, Number(customerDiscountPercent || 0));

  const normalizedItems = items.map((item) => {
    const lineBaseSubtotal = Number((Number(item.qty || 0) * Number(item.price || 0)).toFixed(2));
    const discountPercent = Math.max(0, Number(item.discountPercent ?? normalizedDiscountPercent));
    const discountAmount = Number(((lineBaseSubtotal * discountPercent) / 100).toFixed(2));
    const lineSubtotal = Number((lineBaseSubtotal - discountAmount).toFixed(2));
    const taxRate = Number(item.taxRate || 0);
    const taxAmount = calculateTaxAmount(lineSubtotal, taxRate);
    const lineGrossTotal = Number((lineSubtotal + taxAmount).toFixed(2));

    return {
      ...item,
      discountPercent,
      discountAmount,
      lineBaseSubtotal,
      taxRate,
      lineSubtotal,
      taxAmount,
      lineTotal: lineSubtotal,
      lineGrossTotal,
    };
  });

  const preDiscountSubtotal = normalizedItems.reduce(
    (sum, item) => sum + Number(item.lineBaseSubtotal || 0),
    0
  );
  const discount = normalizedItems.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0);
  const subtotal = normalizedItems.reduce((sum, item) => sum + Number(item.lineSubtotal || 0), 0);
  const tax = normalizedItems.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0);
  const total = Number((subtotal + tax).toFixed(2));

  return {
    items: normalizedItems,
    preDiscountSubtotal: Number(preDiscountSubtotal.toFixed(2)),
    discount: Number(discount.toFixed(2)),
    subtotal: Number(subtotal.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total,
  };
}

async function getSales() {
  return salesRepository.getSales();
}

async function getSaleById(id) {
  const sale = await salesRepository.getSaleById(id);

  if (!sale) {
    throw new AppError(404, "Sale not found.", {
      code: "SALE_NOT_FOUND",
    });
  }

  return sale;
}

async function createSale(payload, actor) {
  const normalized = validateCreateSalePayload(payload);
  const customerProfile = await customerService.resolveCustomerCheckoutProfile({
    customerId: normalized.customerId,
    customerName: normalized.customer,
  });
  const customerDiscountPercent = customerProfile?.discountEligible
    ? Number(customerProfile.discountPercent || 0)
    : 0;
  const saleItems = [];

  for (const item of normalized.items) {
    const product = await salesRepository.getProductById(item.productId);

    if (!product) {
      throw new AppError(400, `Product not found for line ${item.productId}.`, {
        code: "SALE_PRODUCT_NOT_FOUND",
      });
    }

    if (normalized.status === "Paid" && Number(product.stock || 0) < Number(item.qty || 0)) {
      throw new AppError(400, `Insufficient stock for ${product.name}.`, {
        code: "INSUFFICIENT_STOCK",
      });
    }

    saleItems.push({
      id: product.id,
      name: product.name,
      sku: product.sku,
      qty: item.qty,
      price: Number(product.price || 0),
      unitCost: Number(product.unitCost || 0),
      taxClass: product.taxClass,
      taxCode: product.taxCode,
      taxLabel: product.taxLabel,
      taxRate: Number(product.taxRate || 0),
      isTaxable: Boolean(product.isTaxable),
      discountPercent: customerDiscountPercent,
    });
  }

  const totals = computeSaleTotals(saleItems, customerDiscountPercent);
  const createdSale = await salesRepository.createSale({
    id: await salesRepository.getNextSaleId(),
    items: totals.items,
    ...totals,
    customerDiscountPercent,
    customerLoyaltyTier: String(customerProfile?.loyaltyTier || ""),
    customerLoyaltyNumber: String(customerProfile?.loyaltyNumber || ""),
    cashierUserId: actor?.id ?? null,
    cashier: String(actor?.fullName || actor?.staffId || "Front Desk").trim(),
    customerId: customerProfile?.id ?? normalized.customerId ?? null,
    customer: customerProfile?.name || normalized.customer || "Walk-in Customer",
    status: normalized.status,
    channel: normalized.channel,
    paymentMethod: normalized.paymentMethod,
    date: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "sale.created",
    entityType: "sale",
    entityId: String(createdSale.id),
    details: {
      status: createdSale.status,
      total: createdSale.total,
      lineCount: createdSale.items.length,
      paymentMethod: createdSale.paymentMethod,
      channel: createdSale.channel,
    },
  });

  return createdSale;
}

async function updateSaleStatus(id, payload, actor) {
  const existing = await getSaleById(id);
  const { status, reason, note, approvalPin } = validateSaleStatusPayload(payload);
  const nextStatus = normalizeStatus(status);
  const settings = await salesRepository.getAppSettings();

  const allowedTransitions = {
    Pending: new Set(["Paid", "Declined"]),
    Paid: new Set(["Refunded"]),
    Declined: new Set([]),
    Refunded: new Set([]),
  };

  if (nextStatus === "Refunded" && String(actor?.role || "") !== "Owner") {
    throw new AppError(403, "Only the owner can refund an order.", {
      code: "REFUND_NOT_ALLOWED",
    });
  }

  let approvalPinVerified = false;

  if (nextStatus === "Refunded" && settings.requirePinForRefunds) {
    approvalPinVerified = await verifyRefundApprovalPin({ approvalPin, actor, settings });
  }

  if (String(existing.status || "").trim() !== nextStatus) {
    const validNextStates = allowedTransitions[String(existing.status || "").trim()] || new Set();

    if (!validNextStates.has(nextStatus)) {
      throw new AppError(
        409,
        `Cannot change a ${existing.status} sale to ${nextStatus}.`,
        {
          code: "INVALID_SALE_STATUS_TRANSITION",
        }
      );
    }
  }

  const updatedSale = await salesRepository.updateSaleStatus(existing.id, nextStatus, {
    actorUserId: actor?.id ?? null,
    actorName: resolveActorName(actor, existing.cashier || "Front Desk"),
    reason,
    note,
    approvalPinVerified,
    updatedAt: new Date().toISOString(),
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: nextStatus === "Refunded" ? "sale.refunded" : "sale.status_updated",
    entityType: "sale",
    entityId: String(updatedSale.id),
    details: {
      previousStatus: existing.status,
      nextStatus: updatedSale.status,
      total: updatedSale.total,
      reason,
      note,
      approvalPinVerified,
    },
  });

  return updatedSale;
}

async function submitRefundRequest(id, payload, actor) {
  const existing = await getSaleById(id);
  await assertRoleAllowed({
    actor,
    allowedRoles: ["Owner", "Manager", "Cashier"],
    action: "sale.refund_request.create",
    entityType: "sale",
    entityId: String(existing.id),
    message: "Only store operators can file refund incident reports.",
    code: "REFUND_REQUEST_ROLE_REQUIRED",
  });

  if (String(existing.status || "").trim() !== "Paid") {
    throw new AppError(409, "Only paid orders can enter the refund approval queue.", {
      code: "REFUND_REQUEST_STATUS_INVALID",
    });
  }

  if (String(existing?.refundRequest?.status || "None").trim() === "Pending") {
    throw new AppError(409, "A refund request is already pending for this order.", {
      code: "REFUND_REQUEST_ALREADY_PENDING",
    });
  }

  if (String(existing.status || "").trim() === "Refunded") {
    throw new AppError(409, "This order has already been refunded.", {
      code: "REFUND_ALREADY_COMPLETED",
    });
  }

  const request = validateRefundRequestPayload(payload);
  const now = new Date().toISOString();
  const updatedSale = await salesRepository.updateRefundRequest(existing.id, {
    status: "Pending",
    reason: request.reason,
    note: request.note,
    incidentReport: request.incidentReport,
    customerStatement: request.customerStatement,
    requestedAt: now,
    requestedByUserId: actor?.id ?? null,
    requestedByName: resolveActorName(actor, existing.cashier || "Front Desk"),
    reviewedAt: null,
    reviewedByUserId: null,
    reviewedByName: "",
    decisionNote: "",
    approvalPinVerified: false,
    updatedAt: now,
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "sale.refund_requested",
    entityType: "sale",
    entityId: String(existing.id),
    details: {
      status: existing.status,
      total: existing.total,
      reason: request.reason,
      note: request.note,
      incidentReport: request.incidentReport,
    },
  });

  return updatedSale;
}

async function decideRefundRequest(id, payload, actor) {
  const existing = await getSaleById(id);
  await assertRoleAllowed({
    actor,
    allowedRoles: ["Owner"],
    action: "sale.refund_request.decision",
    entityType: "sale",
    entityId: String(existing.id),
    message: "Only the owner can approve or reject refund requests.",
    code: "REFUND_DECISION_ROLE_REQUIRED",
  });

  if (String(existing.status || "").trim() !== "Paid") {
    throw new AppError(409, "Only paid orders can be reviewed for refund approval.", {
      code: "REFUND_DECISION_STATUS_INVALID",
    });
  }

  if (String(existing?.refundRequest?.status || "None").trim() !== "Pending") {
    throw new AppError(409, "There is no pending refund request to review for this order.", {
      code: "REFUND_REQUEST_NOT_PENDING",
    });
  }

  const decision = validateRefundDecisionPayload(payload);
  const now = new Date().toISOString();
  const actorName = resolveActorName(actor, existing.cashier || "Front Desk");

  if (decision.decision === "Rejected") {
    const rejectedSale = await salesRepository.updateRefundRequest(existing.id, {
      ...existing.refundRequest,
      status: "Rejected",
      reviewedAt: now,
      reviewedByUserId: actor?.id ?? null,
      reviewedByName: actorName,
      decisionNote: decision.decisionNote,
      approvalPinVerified: false,
      updatedAt: now,
    });

    await auditLogService.recordAuditEvent({
      actor,
      action: "sale.refund_rejected",
      entityType: "sale",
      entityId: String(existing.id),
      details: {
        total: existing.total,
        reason: existing?.refundRequest?.reason || "",
        decisionNote: decision.decisionNote,
      },
    });

    return rejectedSale;
  }

  const settings = await salesRepository.getAppSettings();
  const approvalPinVerified = await verifyRefundApprovalPin({
    approvalPin: decision.approvalPin,
    actor,
    settings,
  });

  const approvedSale = await salesRepository.updateSaleStatus(existing.id, "Refunded", {
    actorUserId: actor?.id ?? null,
    actorName,
    reason: existing?.refundRequest?.reason || "Approved refund request",
    note: existing?.refundRequest?.note || decision.decisionNote,
    approvalPinVerified,
    updatedAt: now,
    refundRequestPatch: {
      ...existing.refundRequest,
      status: "Approved",
      reviewedAt: now,
      reviewedByUserId: actor?.id ?? null,
      reviewedByName: actorName,
      decisionNote: decision.decisionNote,
      approvalPinVerified,
    },
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "sale.refund_approved",
    entityType: "sale",
    entityId: String(existing.id),
    details: {
      total: existing.total,
      reason: existing?.refundRequest?.reason || "",
      decisionNote: decision.decisionNote,
      approvalPinVerified,
    },
  });

  return approvedSale;
}

module.exports = {
  getSales,
  getSaleById,
  createSale,
  submitRefundRequest,
  decideRefundRequest,
  updateSaleStatus,
};
