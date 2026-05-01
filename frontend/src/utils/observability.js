import { captureMonitoringIncident } from "./monitoring.js";

const CLIENT_REPORT_ENDPOINT =
  import.meta.env.VITE_CLIENT_ERROR_REPORTING_ENDPOINT || "/api/system/client-events";
const CLIENT_REPORTING_ENABLED =
  String(import.meta.env.VITE_CLIENT_ERROR_REPORTING_ENABLED || "true").trim().toLowerCase() !==
  "false";
const CLIENT_REPORTING_SAMPLE_RATE = Math.max(
  0,
  Math.min(1, Number(import.meta.env.VITE_CLIENT_ERROR_REPORTING_SAMPLE_RATE || 1))
);
const APP_RELEASE = String(import.meta.env.VITE_APP_RELEASE || "").trim();
const RECENT_SIGNATURES = new Map();
let handlersInstalled = false;

function normalizeText(value, maxLength = 400) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanupRecentSignatures() {
  const now = Date.now();
  for (const [signature, timestamp] of RECENT_SIGNATURES.entries()) {
    if (now - timestamp > 15000) {
      RECENT_SIGNATURES.delete(signature);
    }
  }
}

function shouldReport(signature, force = false) {
  if (force) {
    return true;
  }

  if (!CLIENT_REPORTING_ENABLED) {
    return false;
  }

  if (CLIENT_REPORTING_SAMPLE_RATE < 1 && Math.random() > CLIENT_REPORTING_SAMPLE_RATE) {
    return false;
  }

  cleanupRecentSignatures();
  if (RECENT_SIGNATURES.has(signature)) {
    return false;
  }

  RECENT_SIGNATURES.set(signature, Date.now());
  return true;
}

function buildClientPayload(payload = {}) {
  return {
    type: normalizeText(payload.type || "frontend_runtime_error", 80),
    level: ["info", "warn", "error"].includes(String(payload.level || "").trim())
      ? String(payload.level).trim()
      : "error",
    message: normalizeText(payload.message, 400),
    reason: normalizeText(payload.reason, 400),
    errorName: normalizeText(payload.errorName, 120),
    stack: normalizeText(payload.stack, 6000),
    componentStack: normalizeText(payload.componentStack, 4000),
    href: normalizeText(typeof window !== "undefined" ? window.location.href : payload.href, 300),
    path: normalizeText(typeof window !== "undefined" ? window.location.pathname : payload.path, 200),
    userAgent: normalizeText(
      typeof navigator !== "undefined" ? navigator.userAgent : payload.userAgent,
      300
    ),
    theme: normalizeText(
      typeof document !== "undefined"
        ? document.body?.dataset?.theme || document.documentElement?.dataset?.theme || ""
        : payload.theme,
      32
    ),
    environment: normalizeText(import.meta.env.MODE || payload.environment, 64),
    release: normalizeText(APP_RELEASE || payload.release, 120),
    tags: Array.isArray(payload.tags)
      ? payload.tags.map((tag) => normalizeText(tag, 48)).filter(Boolean).slice(0, 10)
      : [],
    metadata:
      payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {},
  };
}

function transmitPayload(payload) {
  const body = JSON.stringify(payload);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const sent = navigator.sendBeacon(
        CLIENT_REPORT_ENDPOINT,
        new Blob([body], { type: "application/json" })
      );
      if (sent) {
        return;
      }
    } catch {
      // Fall through to fetch.
    }
  }

  if (typeof fetch === "function") {
    void fetch(CLIENT_REPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      keepalive: true,
      credentials: "include",
    }).catch(() => {});
  }
}

export function reportFrontendIncident(payload = {}, options = {}) {
  try {
    const normalized = buildClientPayload(payload);
    const signature = [
      normalized.type,
      normalized.message,
      normalized.reason,
      normalized.errorName,
      normalized.path,
    ].join("|");

    if (!shouldReport(signature, Boolean(options.force))) {
      return;
    }

    captureMonitoringIncident(normalized);
    transmitPayload(normalized);
  } catch {
    // Reporting must never destabilize the UI.
  }
}

export function installGlobalObservabilityHandlers() {
  if (handlersInstalled || typeof window === "undefined") {
    return;
  }

  handlersInstalled = true;

  window.addEventListener("error", (event) => {
    reportFrontendIncident({
      type: "window_error",
      level: "error",
      message: event?.message || "Unhandled window error.",
      errorName: event?.error?.name || "",
      stack: event?.error?.stack || "",
      metadata: {
        fileName: event?.filename || "",
        lineNumber: event?.lineno || null,
        columnNumber: event?.colno || null,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason =
      typeof event?.reason === "string"
        ? event.reason
        : event?.reason?.message || normalizeText(JSON.stringify(event?.reason || {}), 400);

    reportFrontendIncident({
      type: "unhandled_rejection",
      level: "error",
      message: "Unhandled promise rejection.",
      reason,
      errorName: event?.reason?.name || "",
      stack: event?.reason?.stack || "",
    });
  });
}
