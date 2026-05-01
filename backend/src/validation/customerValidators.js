const {
  ensureObject,
  readBoolean,
  readEnum,
  readOptionalEmail,
  readOptionalString,
  readRequiredString,
  throwValidationError,
} = require("./helpers");

const CONTACT_METHODS = ["None", "Phone", "Email", "SMS"];

function validateCustomerListQuery(query = {}) {
  if (query === null || query === undefined || Array.isArray(query) || typeof query !== "object") {
    throwValidationError("A valid customer query is required.");
  }

  return {
    search: readOptionalString(query.search, {
      label: "Customer search",
      maxLength: 120,
      defaultValue: "",
    }),
  };
}

function validateCustomerPayload(payload) {
  const body = ensureObject(payload);
  const email = readOptionalEmail(body.email, "Customer email");
  const phone = readOptionalString(body.phone, {
    label: "Customer phone",
    maxLength: 40,
    defaultValue: "",
  });
  const loyaltyOptIn = readBoolean(body.loyaltyOptIn, false);
  const marketingOptIn = readBoolean(body.marketingOptIn, false);
  const preferredContactMethod = readEnum(
    body.preferredContactMethod,
    "Preferred contact method",
    CONTACT_METHODS,
    "None"
  );

  if (loyaltyOptIn && !email && !phone) {
    throwValidationError(
      "Loyalty enrollment requires an email or phone number so the welcome message can be delivered."
    );
  }

  if (marketingOptIn && !email && !phone) {
    throwValidationError(
      "Marketing outreach requires an email or phone number."
    );
  }

  if (preferredContactMethod === "Email" && !email) {
    throwValidationError("Preferred contact method Email requires an email address.");
  }

  if ((preferredContactMethod === "Phone" || preferredContactMethod === "SMS") && !phone) {
    throwValidationError(
      `Preferred contact method ${preferredContactMethod} requires a phone number.`
    );
  }

  return {
    name: readRequiredString(body.name, "Customer name", {
      maxLength: 120,
    }),
    email,
    phone,
    notes: readOptionalString(body.notes, {
      label: "Customer notes",
      maxLength: 240,
      defaultValue: "",
    }),
    loyaltyOptIn,
    marketingOptIn,
    preferredContactMethod,
  };
}

module.exports = {
  validateCustomerListQuery,
  validateCustomerPayload,
};
