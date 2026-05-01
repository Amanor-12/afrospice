const Sentry = require("@sentry/node");

const runtime = require("../config/runtime");

let initialized = false;
let expressErrorHandlerInstalled = false;
const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
]);

function isMonitoringEnabled() {
  return Boolean(runtime.sentryEnabled && runtime.sentryDsn);
}

function redactSensitiveHeaders(headers = {}) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return headers;
  }

  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !SENSITIVE_HEADER_KEYS.has(String(key || "").trim().toLowerCase()))
  );
}

function redactSensitiveEvent(event = null) {
  if (!event || typeof event !== "object") {
    return event;
  }

  if (event.request && typeof event.request === "object" && !Array.isArray(event.request)) {
    event.request = {
      ...event.request,
      headers: redactSensitiveHeaders(event.request.headers),
    };
  }

  return event;
}

function initializeMonitoring() {
  if (initialized || !isMonitoringEnabled()) {
    return false;
  }

  Sentry.init({
    dsn: runtime.sentryDsn,
    enabled: true,
    environment: runtime.observabilityEnvironment,
    release: runtime.observabilityRelease || undefined,
    tracesSampleRate: runtime.sentryTracesSampleRate,
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
    defaultIntegrations: false,
    integrations: [Sentry.expressIntegration()],
    beforeSend(event) {
      return redactSensitiveEvent(event);
    },
  });
  initialized = true;
  return true;
}

function setupExpressErrorHandler(app) {
  if (!initializeMonitoring()) {
    return false;
  }

  if (expressErrorHandlerInstalled) {
    return true;
  }

  if (!app || typeof app.use !== "function") {
    return false;
  }

  Sentry.setupExpressErrorHandler(app);
  expressErrorHandlerInstalled = true;
  return true;
}

function applyScope(scope, context = {}) {
  if (!scope || !context || typeof context !== "object") {
    return;
  }

  const level = String(context.level || "").trim();
  if (level) {
    scope.setLevel(level);
  }

  if (context.tags && typeof context.tags === "object" && !Array.isArray(context.tags)) {
    for (const [key, value] of Object.entries(context.tags)) {
      const normalizedKey = String(key || "").trim();
      const normalizedValue = String(value || "").trim();
      if (normalizedKey && normalizedValue) {
        scope.setTag(normalizedKey, normalizedValue);
      }
    }
  }

  if (context.user && typeof context.user === "object" && !Array.isArray(context.user)) {
    const user = Object.fromEntries(
      Object.entries(context.user)
        .map(([key, value]) => [String(key || "").trim(), String(value || "").trim()])
        .filter(([key, value]) => key && value)
    );
    if (Object.keys(user).length) {
      scope.setUser(user);
    }
  }

  if (context.fingerprint && Array.isArray(context.fingerprint)) {
    const fingerprint = context.fingerprint.map((value) => String(value || "").trim()).filter(Boolean);
    if (fingerprint.length) {
      scope.setFingerprint(fingerprint);
    }
  }

  if (context.extra && typeof context.extra === "object" && !Array.isArray(context.extra)) {
    for (const [key, value] of Object.entries(context.extra)) {
      const normalizedKey = String(key || "").trim();
      if (normalizedKey) {
        scope.setExtra(normalizedKey, value);
      }
    }
  }
}

function captureException(error, context = {}) {
  if (!initializeMonitoring()) {
    return {
      attempted: false,
      delivered: false,
      provider: "none",
    };
  }

  const normalizedError =
    error instanceof Error
      ? error
      : new Error(String(error?.message || error || "Unknown monitoring exception"));

  Sentry.withScope((scope) => {
    applyScope(scope, context);
    Sentry.captureException(normalizedError);
  });

  return {
    attempted: true,
    delivered: true,
    provider: "sentry",
  };
}

function captureMessage(message, context = {}) {
  if (!initializeMonitoring()) {
    return {
      attempted: false,
      delivered: false,
      provider: "none",
    };
  }

  const normalizedMessage = String(message || "Monitoring event").trim() || "Monitoring event";

  Sentry.withScope((scope) => {
    applyScope(scope, context);
    Sentry.captureMessage(normalizedMessage);
  });

  return {
    attempted: true,
    delivered: true,
    provider: "sentry",
  };
}

async function flush(timeoutMs = 2000) {
  if (!initialized) {
    return true;
  }

  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}

function getMonitoringSummary() {
  return {
    provider: isMonitoringEnabled() ? "sentry" : "none",
    sentryConfigured: Boolean(runtime.sentryDsn),
    sentryEnabled: Boolean(runtime.sentryEnabled && runtime.sentryDsn),
    tracesSampleRate: runtime.sentryTracesSampleRate,
  };
}

module.exports = {
  initializeMonitoring,
  setupExpressErrorHandler,
  captureException,
  captureMessage,
  flush,
  getMonitoringSummary,
};
