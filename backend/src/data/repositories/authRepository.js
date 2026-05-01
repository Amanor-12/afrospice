const crypto = require("crypto");
const models = require("../models");
const { getRequestContext } = require("../../utils/requestContextStore");
const { resolveSessionExpiry } = require("../../utils/sessionExpiry");

const COUNTER_KEYS = {
  userAccessEvent: "user_access_event_id",
};

function safeDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoTimestamp(value, fallback = null) {
  const parsed = safeDate(value);
  if (parsed) {
    return parsed.toISOString();
  }

  if (fallback === null || fallback === undefined) {
    return new Date().toISOString();
  }

  const fallbackParsed = safeDate(fallback);
  return fallbackParsed ? fallbackParsed.toISOString() : new Date().toISOString();
}

function toNullableIsoTimestamp(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = safeDate(value);
  return parsed ? parsed.toISOString() : fallback;
}

function normalizeTextValue(value) {
  return String(value || "").trim();
}

function normalizeIpAddress(value) {
  const normalized = normalizeTextValue(value).toLowerCase();
  if (!normalized) return "";

  if (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:127.0.0.1")
  ) {
    return "loopback";
  }

  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
}

function normalizeList(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(values.map((value) => normalizeTextValue(value).toLowerCase()).filter(Boolean))];
}

function normalizeRiskLevel(value) {
  const normalized = normalizeTextValue(value).toLowerCase();
  return ["normal", "elevated", "high"].includes(normalized) ? normalized : "normal";
}

function normalizeSeverity(value) {
  const normalized = normalizeTextValue(value).toLowerCase();
  return ["info", "warn", "danger"].includes(normalized) ? normalized : "info";
}

function deriveSessionRiskLevel({ anomalyCount = 0, riskFlags = [] } = {}) {
  const normalizedAnomalyCount = Math.max(0, Number(anomalyCount || 0));
  const flags = normalizeList(riskFlags);
  const hasIpChange = flags.includes("ip_changed");
  const hasUserAgentChange = flags.includes("user_agent_changed");

  if (normalizedAnomalyCount >= 3 || (hasIpChange && hasUserAgentChange)) {
    return "high";
  }

  if (flags.length > 0 || normalizedAnomalyCount > 0) {
    return "elevated";
  }

  return "normal";
}

function describeSessionContextChange(flags = []) {
  const normalizedFlags = normalizeList(flags);
  const changedIp = normalizedFlags.includes("ip_changed");
  const changedUserAgent = normalizedFlags.includes("user_agent_changed");

  if (changedIp && changedUserAgent) {
    return "The active session moved to a new source IP and device signature.";
  }

  if (changedIp) {
    return "The active session moved to a new source IP.";
  }

  if (changedUserAgent) {
    return "The active session moved to a new device signature.";
  }

  return "The active session context changed.";
}

function getAccessEventContext(entry = {}) {
  const context = getRequestContext();

  return {
    sessionId: normalizeTextValue(entry.sessionId || context?.sessionId),
    sourceIp: normalizeIpAddress(entry.sourceIp || context?.sourceIp),
    userAgent: normalizeTextValue(entry.userAgent || context?.userAgent),
    severity: normalizeSeverity(entry.severity),
    tags: normalizeList(entry.tags),
  };
}

function normalizeUser(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    staffId: String(row.staffId || "").trim(),
    pin: String(row.pinHash || ""),
    fullName: String(row.fullName || "").trim(),
    roleId: row.roleId === null || row.roleId === undefined ? null : Number(row.roleId),
    role: String(row.role || "").trim(),
    department: String(row.department || "").trim(),
    email: String(row.email || "").trim(),
    phone: String(row.phone || "").trim(),
    status: String(row.status || "Active").trim() || "Active",
    pinStatus:
      String(row.pinStatus || (String(row.pinHash || "").trim() ? "Assigned" : "Not Set")).trim() ||
      "Not Set",
    approvedBy: String(row.approvedBy || "").trim(),
    shiftAssignment: String(row.shiftAssignment || "Unassigned").trim() || "Unassigned",
    staffNotes: String(row.staffNotes || "").trim(),
    incidentFlag: String(row.incidentFlag || "Clear").trim() || "Clear",
    incidentNote: String(row.incidentNote || "").trim(),
    forcePinChange: Boolean(row.forcePinChange),
    isPinned: Boolean(row.isPinned),
    timetable: row.timetable && typeof row.timetable === "object" ? row.timetable : {},
    createdAt: toIsoTimestamp(row.createdAt, row.invitedAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
    invitedAt: toNullableIsoTimestamp(row.invitedAt),
    approvedAt: toNullableIsoTimestamp(row.approvedAt),
    pinUpdatedAt: toNullableIsoTimestamp(row.pinUpdatedAt),
  };
}

function normalizeSession(row) {
  if (!row) return null;

  return {
    id: String(row.id || "").trim(),
    userId: Number(row.userId || 0),
    staffId: String(row.staffId || "").trim(),
    fullName: String(row.fullName || "").trim(),
    status: String(row.status || "Active").trim() || "Active",
    loginAt: toIsoTimestamp(row.loginAt),
    lastSeenAt: toIsoTimestamp(row.lastSeenAt, row.loginAt),
    logoutAt: toNullableIsoTimestamp(row.logoutAt),
    loginReason: String(row.loginReason || "").trim(),
    logoutReason: String(row.logoutReason || "").trim(),
    loginIp: normalizeIpAddress(row.loginIp),
    lastSeenIp: normalizeIpAddress(row.lastSeenIp),
    loginUserAgent: normalizeTextValue(row.loginUserAgent),
    lastSeenUserAgent: normalizeTextValue(row.lastSeenUserAgent),
    riskLevel: normalizeRiskLevel(row.riskLevel),
    riskFlags: normalizeList(row.riskFlags),
    anomalyCount: Math.max(0, Number(row.anomalyCount || 0)),
    anomalyDetectedAt: toNullableIsoTimestamp(row.anomalyDetectedAt),
  };
}

function buildExactCaseInsensitiveRegex(value) {
  const escaped = String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

async function nextSequence(key) {
  const now = new Date();
  const counter = await models.Counter.findOneAndUpdate(
    { key },
    {
      $inc: { seq: 1 },
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    {
      upsert: true,
      new: true,
    }
  ).lean();

  return Number(counter?.seq || 1);
}

async function logUserAccessEvent(entry = {}) {
  const id = await nextSequence(COUNTER_KEYS.userAccessEvent);
  const metadata = getAccessEventContext(entry);
  await models.UserAccessEvent.create({
    id,
    userId: entry.userId === null || entry.userId === undefined ? null : Number(entry.userId),
    staffId: String(entry.staffId || "").trim(),
    fullName: String(entry.fullName || "").trim(),
    sessionId: metadata.sessionId,
    eventType: String(entry.eventType || "").trim(),
    title: String(entry.title || "").trim(),
    message: String(entry.message || "").trim(),
    actorName: String(entry.actorName || "").trim(),
    sourceIp: metadata.sourceIp,
    userAgent: metadata.userAgent,
    severity: metadata.severity,
    tags: metadata.tags,
    createdAt: safeDate(entry.createdAt) || new Date(),
  });

  return id;
}

async function getUserById(id) {
  const user = await models.User.findOne({ id: Number(id) }).lean();
  return normalizeUser(user);
}

async function getUserByStaffId(staffId) {
  const normalized = String(staffId || "").trim();
  if (!normalized) return null;

  const user = await models.User.findOne({
    staffId: buildExactCaseInsensitiveRegex(normalized),
  }).lean();

  return normalizeUser(user);
}

async function getUserByIdentifier(identifier) {
  const normalized = String(identifier || "").trim();
  if (!normalized) return null;

  if (normalized.includes("@")) {
    const user = await models.User.findOne({
      email: buildExactCaseInsensitiveRegex(normalized.toLowerCase()),
    }).lean();

    return normalizeUser(user);
  }

  return getUserByStaffId(normalized.toUpperCase());
}

async function getPrimaryOwnerUser() {
  const users = await models.User.find({
    role: buildExactCaseInsensitiveRegex("Owner"),
    status: "Active",
  })
    .sort({ id: 1 })
    .limit(2)
    .lean();

  return users.length === 1 ? normalizeUser(users[0]) : null;
}

async function getActiveUsers() {
  const users = await models.User.find({ status: "Active" }).sort({ id: 1 }).lean();
  return users.map(normalizeUser);
}

async function createUserSession(user, options = {}) {
  if (!user?.id) return null;

  const sessionId = String(options.sessionId || crypto.randomUUID()).trim();
  const loginAt = safeDate(options.loginAt) || new Date();
  const loginReason = String(options.loginReason || "Interactive login").trim();
  const sourceIp = normalizeIpAddress(options.sourceIp);
  const userAgent = normalizeTextValue(options.userAgent);
  const concurrentSessionCount = await models.UserSession.countDocuments({
    userId: Number(user.id),
    status: "Active",
  });
  const riskFlags = concurrentSessionCount > 0 ? ["concurrent_session"] : [];
  const riskLevel = deriveSessionRiskLevel({
    anomalyCount: 0,
    riskFlags,
  });

  await models.UserSession.create({
    id: sessionId,
    userId: Number(user.id),
    staffId: String(user.staffId || "").trim(),
    fullName: String(user.fullName || "").trim(),
    status: "Active",
    loginAt,
    lastSeenAt: loginAt,
    logoutAt: null,
    loginReason,
    logoutReason: "",
    loginIp: sourceIp,
    lastSeenIp: sourceIp,
    loginUserAgent: userAgent,
    lastSeenUserAgent: userAgent,
    riskLevel,
    riskFlags,
    anomalyCount: 0,
    anomalyDetectedAt: null,
  });

  await logUserAccessEvent({
    userId: user.id,
    staffId: user.staffId,
    fullName: user.fullName,
    sessionId,
    eventType: "login_success",
    title: "Signed in",
    message: "The staff member signed into the workspace successfully.",
    actorName: String(user.fullName || user.staffId || "Staff").trim(),
    sourceIp,
    userAgent,
    severity: "info",
    tags: ["auth", "session"],
    createdAt: loginAt,
  });

  if (concurrentSessionCount > 0) {
    await logUserAccessEvent({
      userId: user.id,
      staffId: user.staffId,
      fullName: user.fullName,
      sessionId,
      eventType: "concurrent_session_started",
      title: "Concurrent session started",
      message: `A new session was opened while ${concurrentSessionCount} other active session${
        concurrentSessionCount === 1 ? "" : "s"
      } remained open.`,
      actorName: String(user.fullName || user.staffId || "Staff").trim(),
      sourceIp,
      userAgent,
      severity: "warn",
      tags: ["security", "session", "concurrent_session"],
      createdAt: loginAt,
    });
  }

  return getUserSessionById(sessionId);
}

async function getUserSessionById(sessionId) {
  const normalizedId = String(sessionId || "").trim();
  if (!normalizedId) return null;

  const session = await models.UserSession.findOne({ id: normalizedId }).lean();
  return normalizeSession(session);
}

async function reconcileExpiredSessions(options = {}) {
  const query = { status: "Active" };

  if (options.userId !== null && options.userId !== undefined) {
    query.userId = Number(options.userId);
  }

  const rows = await models.UserSession.find(query).lean();
  if (!rows.length) {
    return {
      inspected: 0,
      expired: 0,
      idleExpired: 0,
      absoluteExpired: 0,
      invalidMetadata: 0,
    };
  }

  const operations = [];
  const summary = {
    inspected: rows.length,
    expired: 0,
    idleExpired: 0,
    absoluteExpired: 0,
    invalidMetadata: 0,
  };

  rows.forEach((row) => {
    const evaluation = resolveSessionExpiry(row);
    if (!evaluation.expired) {
      return;
    }

    const logoutAt = safeDate(evaluation.expiredAt) || new Date();
    summary.expired += 1;

    if (evaluation.code === "SESSION_IDLE_EXPIRED") {
      summary.idleExpired += 1;
    } else if (evaluation.code === "SESSION_MAX_AGE_EXPIRED") {
      summary.absoluteExpired += 1;
    } else {
      summary.invalidMetadata += 1;
    }

    operations.push({
      updateOne: {
        filter: { id: String(row.id || "").trim(), status: "Active" },
        update: {
          $set: {
            status: "Closed",
            logoutAt,
            lastSeenAt: logoutAt,
            logoutReason: String(evaluation.logoutReason || "Session expired.").trim(),
          },
        },
      },
    });
  });

  if (operations.length > 0) {
    await models.UserSession.bulkWrite(operations, { ordered: false });
  }

  return summary;
}

async function touchUserSession(sessionId, options = {}) {
  const normalizedId = String(sessionId || "").trim();
  if (!normalizedId) return null;

  const existing = await getUserSessionById(normalizedId);
  if (!existing || String(existing.status || "").trim() !== "Active") {
    return existing;
  }

  const normalizedOptions =
    options && typeof options === "object" && !(options instanceof Date)
      ? options
      : { touchedAt: options };
  const touchedAt = safeDate(normalizedOptions.touchedAt) || new Date();
  const sourceIp = normalizeIpAddress(normalizedOptions.sourceIp);
  const userAgent = normalizeTextValue(normalizedOptions.userAgent);
  const triggeredFlags = [];

  if (sourceIp && existing.lastSeenIp && existing.lastSeenIp !== sourceIp) {
    triggeredFlags.push("ip_changed");
  }

  if (userAgent && existing.lastSeenUserAgent && existing.lastSeenUserAgent !== userAgent) {
    triggeredFlags.push("user_agent_changed");
  }

  const nextRiskFlags = normalizeList([...(existing.riskFlags || []), ...triggeredFlags]);
  const nextAnomalyCount =
    Math.max(0, Number(existing.anomalyCount || 0)) + (triggeredFlags.length > 0 ? 1 : 0);
  const nextRiskLevel = deriveSessionRiskLevel({
    anomalyCount: nextAnomalyCount,
    riskFlags: nextRiskFlags,
  });
  const update = {
    lastSeenAt: touchedAt,
    riskLevel: nextRiskLevel,
    riskFlags: nextRiskFlags,
    anomalyCount: nextAnomalyCount,
  };

  if (sourceIp) {
    update.lastSeenIp = sourceIp;
  }

  if (userAgent) {
    update.lastSeenUserAgent = userAgent;
  }

  if (triggeredFlags.length > 0) {
    update.anomalyDetectedAt = touchedAt;
  }

  await models.UserSession.updateOne(
    { id: normalizedId, status: "Active" },
    {
      $set: update,
    }
  );

  if (triggeredFlags.length > 0) {
    await logUserAccessEvent({
      userId: existing.userId,
      staffId: existing.staffId,
      fullName: existing.fullName,
      sessionId: existing.id,
      eventType: "session_context_changed",
      title: "Session context changed",
      message: `${describeSessionContextChange(triggeredFlags)} Review whether the sign-in moved between networks or devices unexpectedly.`,
      actorName: String(existing.fullName || existing.staffId || "Staff").trim(),
      sourceIp: sourceIp || existing.lastSeenIp,
      userAgent: userAgent || existing.lastSeenUserAgent,
      severity: nextRiskLevel === "high" ? "danger" : "warn",
      tags: ["security", "session", ...triggeredFlags],
      createdAt: touchedAt,
    });
  }

  return getUserSessionById(normalizedId);
}

async function closeUserSession(sessionId, options = {}) {
  const normalizedId = String(sessionId || "").trim();
  if (!normalizedId) return null;

  const existing = await getUserSessionById(normalizedId);
  if (!existing) return null;
  if (String(existing.status || "").trim() !== "Active") {
    return existing;
  }

  const logoutAt = safeDate(options.logoutAt) || new Date();
  const logoutReason = String(options.logoutReason || "Manual logout").trim();

  await models.UserSession.updateOne(
    { id: normalizedId },
    {
      $set: {
        status: "Closed",
        logoutAt,
        lastSeenAt: logoutAt,
        logoutReason,
      },
    }
  );

  await logUserAccessEvent({
    userId: existing.userId,
    staffId: existing.staffId,
    fullName: existing.fullName,
    sessionId: existing.id,
    eventType: "logout",
    title: "Signed out",
    message: "The staff member ended the workspace session.",
    actorName: String(existing.fullName || existing.staffId || "Staff").trim(),
    severity: "info",
    tags: ["auth", "session"],
    createdAt: logoutAt,
  });

  return getUserSessionById(normalizedId);
}

async function recordUserLoginFailure(staffId, reason = "Invalid Staff ID or PIN.") {
  const normalizedStaffId = String(staffId || "").trim().toUpperCase();
  const existing = normalizedStaffId ? await getUserByStaffId(normalizedStaffId) : null;

  await logUserAccessEvent({
    userId: existing?.id ?? null,
    staffId: existing?.staffId || normalizedStaffId,
    fullName: existing?.fullName || "",
    eventType: "login_failed",
    title: "Login failed",
    message: String(reason || "Invalid Staff ID or PIN.").trim(),
    actorName: "Auth",
    severity: "warn",
    tags: ["security", "auth"],
    createdAt: new Date(),
  });

  return null;
}

async function countRecentLoginFailuresForStaffId(staffId, windowMinutes = 15) {
  const normalizedStaffId = String(staffId || "").trim();
  if (!normalizedStaffId) return 0;

  const cutoff = new Date(Date.now() - Number(windowMinutes || 15) * 60 * 1000);
  return models.UserAccessEvent.countDocuments({
    eventType: "login_failed",
    staffId: buildExactCaseInsensitiveRegex(normalizedStaffId),
    createdAt: { $gte: cutoff },
  });
}

async function changeOwnUserPin(id, pinHash) {
  const existing = await getUserById(id);
  if (!existing) return null;

  const changedAt = new Date();
  await models.User.updateOne(
    { id: Number(id) },
    {
      $set: {
        pinHash: String(pinHash || ""),
        pinStatus: "Assigned",
        pinUpdatedAt: changedAt,
        forcePinChange: false,
        updatedAt: changedAt,
      },
    }
  );

  await logUserAccessEvent({
    userId: existing.id,
    staffId: existing.staffId,
    fullName: existing.fullName,
    eventType: "pin_changed_self",
    title: "PIN changed by staff",
    message: "The staff member changed the temporary PIN and cleared first-login reset.",
    actorName: existing.fullName,
    severity: "info",
    tags: ["security", "pin"],
    createdAt: changedAt,
  });

  return getUserById(id);
}

module.exports = {
  getUserById,
  getUserByStaffId,
  getUserByIdentifier,
  getPrimaryOwnerUser,
  getActiveUsers,
  createUserSession,
  getUserSessionById,
  reconcileExpiredSessions,
  touchUserSession,
  closeUserSession,
  recordUserLoginFailure,
  countRecentLoginFailuresForStaffId,
  changeOwnUserPin,
};
