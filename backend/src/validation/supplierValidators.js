const {
  ensureObject,
  readOptionalEmail,
  readNonNegativeNumber,
  readOptionalPositiveInteger,
  readOptionalString,
  readRequiredString,
  throwValidationError,
} = require("./helpers");

function readOptionalBoolean(value, fieldLabel, defaultValue = false) {
  if (value === undefined) {
    return Boolean(defaultValue);
  }

  if (typeof value === "boolean") {
    return value;
  }

  throwValidationError(`${fieldLabel} must be true or false.`);
}

function validateSupplierListQuery(query = {}) {
  if (query === null || query === undefined || Array.isArray(query) || typeof query !== "object") {
    throwValidationError("A valid supplier query is required.");
  }

  return {
    search: readOptionalString(query.search, {
      label: "Supplier search",
      maxLength: 120,
      defaultValue: "",
    }),
  };
}

function validateSupplierPayload(payload) {
  const body = ensureObject(payload);
  const leadTimeDays = readOptionalLeadTime(body.leadTimeDays);
  const serviceLevelTarget = readOptionalServiceLevelTarget(body.serviceLevelTarget);
  const minimumOrderValue = readOptionalOrderValue(body.minimumOrderValue);
  const minimumOrderUnits = readOptionalOrderUnits(body.minimumOrderUnits);

  return {
    name: readRequiredString(body.name, "Supplier name", {
      maxLength: 120,
    }),
    contactName: readOptionalString(body.contactName, {
      label: "Supplier contact name",
      maxLength: 120,
      defaultValue: "",
    }),
    email: readOptionalEmail(body.email, "Supplier email"),
    phone: readOptionalString(body.phone, {
      label: "Supplier phone",
      maxLength: 40,
      defaultValue: "",
    }),
    accountCode: readOptionalString(body.accountCode, {
      label: "Supplier account code",
      maxLength: 60,
      defaultValue: "",
    }),
    preferredCategory: readOptionalString(body.preferredCategory, {
      label: "Supplier preferred category",
      maxLength: 80,
      defaultValue: "",
    }),
    paymentTerms: readOptionalString(body.paymentTerms, {
      label: "Supplier payment terms",
      maxLength: 80,
      defaultValue: "",
    }),
    reviewCadence: readOptionalString(body.reviewCadence, {
      label: "Supplier review cadence",
      maxLength: 80,
      defaultValue: "",
    }),
    shipmentCadence: readOptionalString(body.shipmentCadence, {
      label: "Supplier shipment cadence",
      maxLength: 80,
      defaultValue: "",
    }),
    orderingCutoffTime: readOptionalString(body.orderingCutoffTime, {
      label: "Supplier ordering cutoff",
      maxLength: 80,
      defaultValue: "",
    }),
    minimumOrderValue,
    minimumOrderUnits,
    logisticsMode: readOptionalString(body.logisticsMode, {
      label: "Supplier logistics mode",
      maxLength: 80,
      defaultValue: "",
    }),
    dispatchRegion: readOptionalString(body.dispatchRegion, {
      label: "Supplier dispatch region",
      maxLength: 120,
      defaultValue: "",
    }),
    receivingWindow: readOptionalString(body.receivingWindow, {
      label: "Supplier receiving window",
      maxLength: 120,
      defaultValue: "",
    }),
    receivingDock: readOptionalString(body.receivingDock, {
      label: "Supplier receiving dock",
      maxLength: 120,
      defaultValue: "",
    }),
    complianceTier: readOptionalString(body.complianceTier, {
      label: "Supplier compliance tier",
      maxLength: 80,
      defaultValue: "",
    }),
    escalationContact: readOptionalString(body.escalationContact, {
      label: "Supplier escalation contact",
      maxLength: 120,
      defaultValue: "",
    }),
    portalReference: readOptionalString(body.portalReference, {
      label: "Supplier portal reference",
      maxLength: 120,
      defaultValue: "",
    }),
    trackingUrl: readOptionalString(body.trackingUrl, {
      label: "Supplier tracking URL",
      maxLength: 240,
      defaultValue: "",
    }),
    leadTimeDays,
    serviceLevelTarget,
    notes: readOptionalString(body.notes, {
      label: "Supplier notes",
      maxLength: 240,
      defaultValue: "",
    }),
    isPreferred: readOptionalBoolean(body.isPreferred, "Supplier preferred flag", false),
    isActive: readOptionalBoolean(body.isActive, "Supplier active flag", true),
  };
}

function readOptionalLeadTime(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = readOptionalPositiveInteger(value, "Supplier lead time", null);

  if (parsed === null) {
    return null;
  }

  if (parsed > 365) {
    throwValidationError("Supplier lead time must be 365 days or fewer.");
  }

  return parsed;
}

function readOptionalServiceLevelTarget(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = readNonNegativeNumber(value, "Supplier service level target");

  if (parsed > 100) {
    throwValidationError("Supplier service level target must be 100 or lower.");
  }

  return parsed;
}

function readOptionalOrderValue(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = readNonNegativeNumber(value, "Supplier minimum order value");

  if (parsed > 1000000) {
    throwValidationError("Supplier minimum order value must be 1000000 or lower.");
  }

  return parsed;
}

function readOptionalOrderUnits(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = readOptionalPositiveInteger(value, "Supplier minimum order units", null);

  if (parsed === null) {
    return null;
  }

  if (parsed > 100000) {
    throwValidationError("Supplier minimum order units must be 100000 or fewer.");
  }

  return parsed;
}

module.exports = {
  validateSupplierListQuery,
  validateSupplierPayload,
};
