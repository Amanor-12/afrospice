const auditLogRepository = require("../data/repositories/auditLogRepository");
const { getRequestContext } = require("../utils/requestContextStore");

const SYSTEM_ACTOR = Object.freeze({
  id: null,
  staffId: "SYSTEM",
  fullName: "System Automation",
});

function buildRequestSnapshot(requestContext = null) {
  const context = requestContext || getRequestContext();

  if (!context) {
    return {
      requestId: "",
      request: {},
    };
  }

  return {
    requestId: String(context.requestId || "").trim(),
    request: {
      method: String(context.method || "").trim(),
      path: String(context.path || context.routePath || "").trim(),
      sourceIp: String(context.sourceIp || "").trim(),
      userAgent: String(context.userAgent || "").trim(),
      sessionId: String(context.sessionId || "").trim(),
    },
  };
}

async function recordAuditEvent({
  actor = null,
  action,
  entityType,
  entityId,
  details = {},
  requestContext = null,
}) {
  const activeRequestContext = requestContext || getRequestContext();
  const requestSnapshot = buildRequestSnapshot(activeRequestContext);
  const effectiveActor =
    actor ||
    (activeRequestContext
      ? {
          id: activeRequestContext.actorUserId,
          staffId: activeRequestContext.actorStaffId,
          fullName: activeRequestContext.actorName,
        }
      : null) ||
    SYSTEM_ACTOR;

  return auditLogRepository.insertAuditLog({
    action,
    entityType,
    entityId,
    actorUserId: effectiveActor?.id ?? null,
    actorStaffId: effectiveActor?.staffId || "",
    actorName: effectiveActor?.fullName || effectiveActor?.staffId || "System",
    details,
    requestId: requestSnapshot.requestId,
    request: requestSnapshot.request,
    createdAt: new Date().toISOString(),
  });
}

module.exports = {
  recordAuditEvent,
};
