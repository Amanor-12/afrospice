const {
  ensureObject,
  readOptionalString,
  readRequiredString,
  throwValidationError,
} = require("./helpers");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeAuthIdentifier(value) {
  const normalized = readRequiredString(value, "Staff ID or email", {
    maxLength: 120,
  });

  if (EMAIL_REGEX.test(normalized.toLowerCase())) {
    return normalized.toLowerCase();
  }

  const staffId = normalized.toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(staffId)) {
    throwValidationError("Staff ID contains invalid characters.");
  }

  return staffId;
}

function normalizeOptionalAuthIdentifier(value) {
  const raw = readOptionalString(value, {
    label: "Staff ID or email",
    maxLength: 120,
    defaultValue: "",
  });

  return raw ? normalizeAuthIdentifier(raw) : "";
}

function validateLoginPayload(payload) {
  const body = ensureObject(payload);
  const identifier = normalizeOptionalAuthIdentifier(body.staffId ?? body.identifier);
  const pin = readRequiredString(body.pin, "PIN", {
    minLength: 4,
    maxLength: 6,
  });

  if (!/^\d{4,6}$/.test(pin)) {
    throwValidationError("PIN must be 4-6 digits.");
  }

  return {
    identifier,
    pin,
  };
}

function validateChangePinPayload(payload) {
  const body = ensureObject(payload);
  const currentPin = readRequiredString(body.currentPin, "Current PIN", {
    minLength: 4,
    maxLength: 6,
  });
  const nextPin = readRequiredString(body.nextPin, "New PIN", {
    minLength: 4,
    maxLength: 6,
  });
  const confirmPin = readRequiredString(body.confirmPin, "PIN confirmation", {
    minLength: 4,
    maxLength: 6,
  });

  if (!/^\d{4,6}$/.test(currentPin) || !/^\d{4,6}$/.test(nextPin) || !/^\d{4,6}$/.test(confirmPin)) {
    throwValidationError("PIN values must be 4-6 digits.");
  }

  if (nextPin !== confirmPin) {
    throwValidationError("PIN confirmation does not match.");
  }

  return {
    currentPin,
    nextPin,
    confirmPin,
  };
}

function validatePasskeyIdentifierPayload(payload) {
  const body = ensureObject(payload);

  return {
    identifier: normalizeOptionalAuthIdentifier(body.identifier ?? body.staffId),
  };
}

function validatePasskeyRegistrationPayload(payload) {
  const body = ensureObject(payload);
  const response =
    body.response && typeof body.response === "object" && !Array.isArray(body.response)
      ? body.response
      : null;

  return {
    label: readOptionalString(body.label, {
      label: "Passkey label",
      maxLength: 80,
      defaultValue: "",
    }),
    response,
  };
}

function validatePasskeyAuthenticationPayload(payload) {
  const body = ensureObject(payload);
  const response =
    body.response && typeof body.response === "object" && !Array.isArray(body.response)
      ? body.response
      : null;

  if (!response) {
    throwValidationError("A valid passkey response is required.");
  }

  return {
    identifier: normalizeOptionalAuthIdentifier(body.identifier ?? body.staffId),
    response,
  };
}

module.exports = {
  validateLoginPayload,
  validateChangePinPayload,
  validatePasskeyIdentifierPayload,
  validatePasskeyRegistrationPayload,
  validatePasskeyAuthenticationPayload,
};
