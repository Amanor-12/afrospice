const AppError = require("../errors/AppError");
const auditLogService = require("./auditLogService");

function normalizeRole(actor) {
  return String(actor?.role || "").trim();
}

function hasAnyRole(actor, ...allowedRoles) {
  const actorRole = normalizeRole(actor);
  return allowedRoles.map((role) => String(role || "").trim()).includes(actorRole);
}

async function recordDeniedAction({
  actor,
  action,
  entityType,
  entityId,
  reason,
  details = {},
}) {
  await auditLogService.recordAuditEvent({
    actor,
    action: `${action}.denied`,
    entityType,
    entityId,
    details: {
      actorRole: normalizeRole(actor),
      reason: String(reason || "Operation denied.").trim(),
      ...details,
    },
  });
}

async function assertRoleAllowed({
  actor,
  allowedRoles = [],
  action,
  entityType,
  entityId,
  message,
  code = "ROLE_NOT_ALLOWED",
  details = {},
}) {
  if (hasAnyRole(actor, ...allowedRoles)) {
    return;
  }

  const reason = String(message || "You do not have permission to perform this action.").trim();
  await recordDeniedAction({
    actor,
    action,
    entityType,
    entityId,
    reason,
    details: {
      requiredRoles: allowedRoles,
      ...details,
    },
  });

  throw new AppError(403, reason, {
    code,
  });
}

module.exports = {
  normalizeRole,
  hasAnyRole,
  recordDeniedAction,
  assertRoleAllowed,
};
