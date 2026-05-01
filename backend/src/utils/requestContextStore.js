const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const requestContextStorage = new AsyncLocalStorage();

function createRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString("hex");
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }

  return String(value || "").trim();
}

function resolveClientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "").trim();
}

function createRequestContext(req) {
  const startedAtMs = Date.now();

  return {
    requestId: createRequestId(),
    startedAt: new Date(startedAtMs).toISOString(),
    startTimeMs: startedAtMs,
    method: String(req.method || "").trim(),
    path: String(req.originalUrl || req.url || "").trim(),
    routePath: String(req.path || "").trim(),
    sourceIp: resolveClientIp(req),
    userAgent: normalizeHeaderValue(req.headers?.["user-agent"]),
    actorUserId: null,
    actorStaffId: "",
    actorName: "",
    actorRole: "",
    sessionId: "",
  };
}

function runWithRequestContext(context, callback) {
  return requestContextStorage.run(context, callback);
}

function getRequestContext() {
  return requestContextStorage.getStore() || null;
}

function updateRequestContext(patch = {}) {
  const context = getRequestContext();

  if (!context || !patch || typeof patch !== "object") {
    return context;
  }

  Object.assign(context, patch);
  return context;
}

function getRequestDurationMs(context = getRequestContext()) {
  if (!context?.startTimeMs) {
    return null;
  }

  return Number((Date.now() - Number(context.startTimeMs)).toFixed(1));
}

function buildRequestMeta(context = getRequestContext()) {
  if (!context) {
    return null;
  }

  const meta = {};
  const durationMs = getRequestDurationMs(context);

  if (context.requestId) {
    meta.requestId = context.requestId;
  }

  if (durationMs !== null) {
    meta.durationMs = durationMs;
  }

  return Object.keys(meta).length > 0 ? meta : null;
}

module.exports = {
  createRequestContext,
  runWithRequestContext,
  getRequestContext,
  updateRequestContext,
  getRequestDurationMs,
  buildRequestMeta,
  resolveClientIp,
};
