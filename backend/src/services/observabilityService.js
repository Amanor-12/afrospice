const runtime = require("../config/runtime");
const logger = require("../utils/logger");
const monitoringService = require("./monitoringService");
const {
  ensureObject,
  readEnum,
  readOptionalString,
  throwValidationError,
} = require("../validation/helpers");

function sanitizeMultilineText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeScalar(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return sanitizeMultilineText(value, 500);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return sanitizeMultilineText(JSON.stringify(value), 500);
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 2 || value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((entry) => sanitizeMetadata(entry, depth + 1));
  }

  if (typeof value !== "object") {
    return sanitizeScalar(value);
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 20)
      .map(([key, entry]) => [String(key || "").trim().slice(0, 80), sanitizeMetadata(entry, depth + 1)])
      .filter(([key, entry]) => key && entry !== null && entry !== undefined)
  );
}

function sanitizeTagList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => readOptionalString(value, { maxLength: 48 })).filter(Boolean))].slice(
    0,
    10
  );
}

function getObservabilitySummary() {
  return {
    requestTracing: true,
    structuredRequestLogs: true,
    auditRequestCorrelation: true,
    sessionSecurityTelemetry: true,
    responseMeta: ["requestId", "durationMs"],
    gracefulShutdown: true,
    clientErrorIntakeEnabled: runtime.clientErrorReportingEnabled,
    clientErrorReportingSampleRate: runtime.clientErrorReportingSampleRate,
    externalWebhookConfigured: Boolean(runtime.observabilityWebhookUrl),
    monitoring: monitoringService.getMonitoringSummary(),
    serviceName: runtime.observabilityServiceName,
    environment: runtime.observabilityEnvironment,
    release: runtime.observabilityRelease || null,
  };
}

function normalizeClientReport(payload = {}, requestContext = null) {
  const body = ensureObject(payload, "A valid client event payload is required.");
  const message = readOptionalString(body.message, {
    label: "Client event message",
    maxLength: 400,
  });
  const stack = sanitizeMultilineText(body.stack, 6000);
  const reason = readOptionalString(body.reason, {
    label: "Client event reason",
    maxLength: 400,
  });

  if (!message && !stack && !reason) {
    throwValidationError("Client event message, reason, or stack is required.");
  }

  return {
    channel: "frontend",
    type: readOptionalString(body.type, {
      label: "Client event type",
      maxLength: 80,
      defaultValue: "frontend_runtime_error",
    }),
    level: readEnum(body.level, "Client event level", ["info", "warn", "error"], "error"),
    message,
    reason,
    errorName: readOptionalString(body.errorName, {
      label: "Client error name",
      maxLength: 120,
    }),
    stack,
    componentStack: sanitizeMultilineText(body.componentStack, 4000),
    href: readOptionalString(body.href, {
      label: "Client event href",
      maxLength: 300,
    }),
    path: readOptionalString(body.path, {
      label: "Client event path",
      maxLength: 200,
    }),
    userAgent: readOptionalString(body.userAgent, {
      label: "Client event user agent",
      maxLength: 300,
    }),
    theme: readOptionalString(body.theme, {
      label: "Client event theme",
      maxLength: 32,
    }),
    release: readOptionalString(body.release, {
      label: "Client event release",
      maxLength: 120,
    }),
    environment: readOptionalString(body.environment, {
      label: "Client event environment",
      maxLength: 64,
      defaultValue: runtime.observabilityEnvironment,
    }),
    tags: sanitizeTagList(body.tags),
    metadata: sanitizeMetadata(body.metadata || {}),
    requestContext: {
      requestId: String(requestContext?.requestId || "").trim(),
      sourceIp: String(requestContext?.sourceIp || "").trim(),
      ingestPath: String(requestContext?.path || "").trim(),
    },
    reportedAt: new Date().toISOString(),
  };
}

function buildMonitoringContext(eventType, payload = {}) {
  const rawLevel = String(payload.level || payload.severity || "").trim().toLowerCase();
  const level = ["fatal", "error", "warning", "log", "info", "debug"].includes(rawLevel)
    ? rawLevel
    : "error";

  return {
    level: level === "fatal" ? "error" : level,
    tags: {
      event_type: String(eventType || "observability_event").trim() || "observability_event",
      channel: String(payload.channel || "backend").trim() || "backend",
    },
    user:
      payload?.actorUserId || payload?.requestContext?.requestId
        ? {
            id: String(payload.actorUserId || payload.requestContext?.requestId || "").trim(),
          }
        : null,
    fingerprint: [
      String(eventType || "observability_event").trim() || "observability_event",
      String(payload.channel || "backend").trim() || "backend",
    ],
    extra: payload,
  };
}

function forwardMonitoringEvent(eventType, payload = {}) {
  const normalizedEventType = String(eventType || "").trim();

  if (normalizedEventType === "frontend_incident" || normalizedEventType === "server_incident") {
    return {
      attempted: false,
      delivered: false,
      provider: "none",
    };
  }

  const monitoringContext = buildMonitoringContext(normalizedEventType, payload);
  const errorName = readOptionalString(payload.errorName || payload.name, {
    maxLength: 120,
  });
  const message = readOptionalString(payload.message || payload.reason, {
    maxLength: 400,
    defaultValue: String(normalizedEventType || "Observability event"),
  });
  const stack = sanitizeMultilineText(payload.stack, 12000);

  if (stack || errorName) {
    const error = new Error(message);
    if (errorName) {
      error.name = errorName;
    }
    if (stack) {
      error.stack = stack;
    }

    return monitoringService.captureException(error, monitoringContext);
  }

  return monitoringService.captureMessage(message, monitoringContext);
}

async function forwardObservabilityEvent(eventType, payload = {}) {
  const monitoring = forwardMonitoringEvent(eventType, payload);

  if (!runtime.observabilityWebhookUrl) {
    return {
      attempted: monitoring.attempted,
      delivered: monitoring.delivered,
      statusCode: null,
      monitoring,
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), runtime.observabilityWebhookTimeoutMs);

  try {
    const response = await fetch(runtime.observabilityWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        service: runtime.observabilityServiceName,
        environment: runtime.observabilityEnvironment,
        release: runtime.observabilityRelease || null,
        generatedAt: new Date().toISOString(),
        eventType: String(eventType || "observability_event").trim() || "observability_event",
        payload,
      }),
      signal: controller.signal,
    });

    return {
      attempted: true,
      delivered: response.ok,
      statusCode: Number(response.status || 0) || null,
      monitoring,
    };
  } catch (error) {
    logger.warn("observability.webhook.failed", {
      eventType,
      message: error?.message || String(error),
    });
    return {
      attempted: true,
      delivered: false,
      statusCode: null,
      monitoring,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = {
  getObservabilitySummary,
  normalizeClientReport,
  forwardObservabilityEvent,
};
