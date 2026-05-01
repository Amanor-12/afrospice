const {
  ensureObject,
  readOptionalPositiveInteger,
  readOptionalString,
  readPositiveInteger,
  readEnum,
  throwValidationError,
} = require("./helpers");

const SALE_CHANNELS = ["In-Store", "Online", "Delivery", "Pickup"];
const PAYMENT_METHODS = ["Card", "Cash", "Transfer", "Mobile Money", "Other"];
const SALE_STATUSES = ["Pending", "Paid"];
const SALE_STATUS_UPDATES = ["Pending", "Paid", "Declined", "Refunded"];
const REFUND_DECISIONS = ["Approved", "Rejected"];

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throwValidationError("Sale items are required.");
  }

  return items.map((item, index) => {
    const productId = readPositiveInteger(item?.id ?? item?.productId, `Line ${index + 1} product`);
    const qty = readPositiveInteger(item?.qty, `Line ${index + 1} quantity`);

    return {
      productId,
      qty,
    };
  });
}

function validateCreateSalePayload(payload) {
  const body = ensureObject(payload);

  return {
    items: normalizeItems(body.items),
    customerId: readOptionalPositiveInteger(body.customerId, "Customer"),
    customer: readOptionalString(body.customer, {
      label: "Customer",
      maxLength: 120,
      defaultValue: "Walk-in Customer",
    }),
    channel: readEnum(body.channel, "Channel", SALE_CHANNELS, "In-Store"),
    paymentMethod: readEnum(body.paymentMethod, "Payment method", PAYMENT_METHODS, "Card"),
    status: readEnum(body.status, "Sale status", SALE_STATUSES, "Paid"),
  };
}

function validateSaleStatusPayload(payload) {
  const body = ensureObject(payload);
  const status = readEnum(body.status, "Sale status", SALE_STATUS_UPDATES);
  const reason = readOptionalString(body.reason, {
    label: "Refund reason",
    maxLength: 240,
    defaultValue: "",
  });
  const note = readOptionalString(body.note, {
    label: "Status note",
    maxLength: 400,
    defaultValue: "",
  });
  const approvalPin = readOptionalString(body.approvalPin, {
    label: "Approval PIN",
    maxLength: 6,
    defaultValue: "",
  });

  if (status === "Refunded" && reason.length < 6) {
    throwValidationError("Refund reason must be at least 6 characters.");
  }

  if (approvalPin && !/^\d{4,6}$/.test(approvalPin)) {
    throwValidationError("Approval PIN must use 4-6 digits.");
  }

  return {
    status,
    reason,
    note,
    approvalPin,
  };
}

function validateRefundRequestPayload(payload) {
  const body = ensureObject(payload);
  const reason = readOptionalString(body.reason, {
    label: "Refund reason",
    maxLength: 240,
    defaultValue: "",
  });
  const note = readOptionalString(body.note, {
    label: "Internal note",
    maxLength: 400,
    defaultValue: "",
  });
  const incidentReport = readOptionalString(body.incidentReport, {
    label: "Incident report",
    maxLength: 800,
    defaultValue: "",
  });
  const customerStatement = readOptionalString(body.customerStatement, {
    label: "Customer statement",
    maxLength: 320,
    defaultValue: "",
  });

  if (reason.length < 6) {
    throwValidationError("Refund reason must be at least 6 characters.");
  }

  if (incidentReport.length < 12) {
    throwValidationError("Incident report must be at least 12 characters.");
  }

  return {
    reason,
    note,
    incidentReport,
    customerStatement,
  };
}

function validateRefundDecisionPayload(payload) {
  const body = ensureObject(payload);
  const decision = readEnum(body.decision, "Refund decision", REFUND_DECISIONS);
  const decisionNote = readOptionalString(body.decisionNote, {
    label: "Decision note",
    maxLength: 400,
    defaultValue: "",
  });
  const approvalPin = readOptionalString(body.approvalPin, {
    label: "Approval PIN",
    maxLength: 6,
    defaultValue: "",
  });

  if (decisionNote.length < 6) {
    throwValidationError("Decision note must be at least 6 characters.");
  }

  if (approvalPin && !/^\d{4,6}$/.test(approvalPin)) {
    throwValidationError("Approval PIN must use 4-6 digits.");
  }

  return {
    decision,
    decisionNote,
    approvalPin,
  };
}

module.exports = {
  validateCreateSalePayload,
  validateSaleStatusPayload,
  validateRefundRequestPayload,
  validateRefundDecisionPayload,
};
