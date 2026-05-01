require("./loadEnv");

function readBoolean(rawValue, fallbackValue = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  return String(rawValue).trim().toLowerCase() === "true";
}

function readBoundedInteger(rawValue, fallbackValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeOptionalText(value) {
  return String(value || "").trim();
}

function getConfiguredProvider() {
  const configured = normalizeOptionalText(process.env.MAIL_PROVIDER).toLowerCase();
  if (configured === "resend" || configured === "smtp") {
    return configured;
  }

  return normalizeOptionalText(process.env.RESEND_API_KEY) ? "resend" : "smtp";
}

function getResendConfig() {
  const apiKey = normalizeOptionalText(process.env.RESEND_API_KEY);
  const fromEmail = normalizeOptionalText(
    process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL || "onboarding@resend.dev"
  );
  const fromName = normalizeOptionalText(
    process.env.RESEND_FROM_NAME || process.env.SMTP_FROM_NAME || "AfroSpice Operations"
  );
  const replyTo = normalizeOptionalText(
    process.env.RESEND_REPLY_TO || process.env.SMTP_REPLY_TO || process.env.SMTP_FROM_EMAIL
  );
  const missing = [];

  if (!apiKey) missing.push("RESEND_API_KEY");
  if (!fromEmail) missing.push("RESEND_FROM_EMAIL");

  return {
    provider: "resend",
    apiKey,
    fromEmail,
    fromName,
    replyTo,
    missing,
    configured: missing.length === 0,
  };
}

function getSmtpConfig() {
  const host = normalizeOptionalText(process.env.SMTP_HOST);
  const port = readBoundedInteger(process.env.SMTP_PORT, 587, {
    min: 1,
    max: 65535,
  });
  const secure = readBoolean(process.env.SMTP_SECURE, port === 465);
  const user = normalizeOptionalText(process.env.SMTP_USER);
  const pass = normalizeOptionalText(process.env.SMTP_PASS);
  const fromEmail = normalizeOptionalText(process.env.SMTP_FROM_EMAIL);
  const fromName = normalizeOptionalText(process.env.SMTP_FROM_NAME || "AfroSpice Operations");
  const replyTo = normalizeOptionalText(process.env.SMTP_REPLY_TO || fromEmail);
  const pool = readBoolean(process.env.SMTP_POOL, true);
  const connectionTimeout = readBoundedInteger(
    process.env.SMTP_CONNECTION_TIMEOUT_MS,
    10000,
    { min: 1000, max: 120000 }
  );
  const greetingTimeout = readBoundedInteger(process.env.SMTP_GREETING_TIMEOUT_MS, 10000, {
    min: 1000,
    max: 120000,
  });
  const socketTimeout = readBoundedInteger(process.env.SMTP_SOCKET_TIMEOUT_MS, 20000, {
    min: 1000,
    max: 180000,
  });

  const missing = [];

  if (!host) missing.push("SMTP_HOST");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (!fromEmail) missing.push("SMTP_FROM_EMAIL");

  return {
    provider: "smtp",
    host,
    port,
    secure,
    user,
    pass,
    fromEmail,
    fromName,
    replyTo,
    pool,
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    missing,
    configured: missing.length === 0,
  };
}

function getMailConfig() {
  const provider = getConfiguredProvider();
  return provider === "resend" ? getResendConfig() : getSmtpConfig();
}

module.exports = {
  getMailConfig,
};
