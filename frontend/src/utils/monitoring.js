import * as Sentry from "@sentry/react";

const SENTRY_DSN = String(import.meta.env.VITE_SENTRY_DSN || "").trim();
const SENTRY_ENABLED =
  String(import.meta.env.VITE_SENTRY_ENABLED || String(Boolean(SENTRY_DSN)))
    .trim()
    .toLowerCase() === "true" && Boolean(SENTRY_DSN);
const SENTRY_TRACES_SAMPLE_RATE = Math.max(
  0,
  Math.min(1, Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0))
);
const APP_RELEASE = String(import.meta.env.VITE_APP_RELEASE || "").trim();

let initialized = false;

function applyScope(scope, payload = {}) {
  const level = String(payload.level || "").trim();
  if (level) {
    scope.setLevel(level);
  }

  const type = String(payload.type || "").trim();
  if (type) {
    scope.setTag("event_type", type);
  }
  scope.setTag("channel", "frontend");

  const path =
    typeof window !== "undefined"
      ? String(window.location.pathname || "").trim()
      : String(payload.path || "").trim();
  if (path) {
    scope.setTag("path", path);
  }

  if (payload.release || APP_RELEASE) {
    scope.setTag("release", String(payload.release || APP_RELEASE).trim());
  }

  if (payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)) {
    for (const [key, value] of Object.entries(payload.metadata)) {
      const normalizedKey = String(key || "").trim();
      if (normalizedKey) {
        scope.setExtra(normalizedKey, value);
      }
    }
  }

  if (payload.componentStack) {
    scope.setExtra("componentStack", String(payload.componentStack || "").trim());
  }
}

export function initializeMonitoring() {
  if (initialized || !SENTRY_ENABLED) {
    return false;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: true,
    environment: import.meta.env.MODE,
    release: APP_RELEASE || undefined,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
    defaultIntegrations: false,
  });
  initialized = true;
  return true;
}

export function captureMonitoringIncident(payload = {}) {
  if (!initializeMonitoring()) {
    return false;
  }

  const message = String(payload.message || payload.reason || payload.type || "Frontend incident").trim();
  const stack = String(payload.stack || "").trim();
  const errorName = String(payload.errorName || "").trim();

  Sentry.withScope((scope) => {
    applyScope(scope, payload);

    if (stack || errorName) {
      const error = new Error(message || "Frontend incident");
      if (errorName) {
        error.name = errorName;
      }
      if (stack) {
        error.stack = stack;
      }
      Sentry.captureException(error);
      return;
    }

    Sentry.captureMessage(message || "Frontend incident");
  });

  return true;
}

export function getMonitoringSummary() {
  return {
    provider: SENTRY_ENABLED ? "sentry" : "none",
    sentryConfigured: Boolean(SENTRY_DSN),
    sentryEnabled: SENTRY_ENABLED,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  };
}
