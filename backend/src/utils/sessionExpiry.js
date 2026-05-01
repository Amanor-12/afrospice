const runtime = require("../config/runtime");

function readSessionDate(value) {
  if (!value) return null;

  const normalized = value instanceof Date ? value : new Date(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function resolveSessionExpiry(session) {
  const loginAt = readSessionDate(session?.loginAt);
  const lastSeenAt = readSessionDate(session?.lastSeenAt) || loginAt;

  if (!loginAt || !lastSeenAt) {
    return {
      expired: true,
      expiredAt: new Date(),
      reason: "Session metadata is invalid. Please sign in again.",
      logoutReason: "Session metadata was invalid.",
      code: "SESSION_INVALID_METADATA",
    };
  }

  const now = Date.now();
  const idleTimeoutMs = runtime.sessionIdleTimeoutMinutes * 60 * 1000;
  const absoluteTimeoutMs = runtime.sessionAbsoluteTimeoutMinutes * 60 * 1000;
  const idleExpiryAt = new Date(lastSeenAt.getTime() + idleTimeoutMs);
  const absoluteExpiryAt = new Date(loginAt.getTime() + absoluteTimeoutMs);

  if (now > idleExpiryAt.getTime()) {
    return {
      expired: true,
      expiredAt: idleExpiryAt,
      reason: "Session expired due to inactivity. Please sign in again.",
      logoutReason: "Session expired due to inactivity.",
      code: "SESSION_IDLE_EXPIRED",
    };
  }

  if (now > absoluteExpiryAt.getTime()) {
    return {
      expired: true,
      expiredAt: absoluteExpiryAt,
      reason: "Session expired. Please sign in again.",
      logoutReason: "Session reached its maximum lifetime.",
      code: "SESSION_MAX_AGE_EXPIRED",
    };
  }

  return {
    expired: false,
    expiredAt: null,
  };
}

module.exports = {
  readSessionDate,
  resolveSessionExpiry,
};
