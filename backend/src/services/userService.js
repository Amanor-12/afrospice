const bcrypt = require("bcryptjs");
const AppError = require("../errors/AppError");
const userRepository = require("../data/repositories/userRepository");
const auditLogService = require("./auditLogService");
const {
  normalizeRole,
  getDefaultShiftForRole,
  validateUserPayload,
  validateWorkforceProfilePayload,
  validatePinAssignmentPayload,
  validateUserStatusPayload,
  validateSavedUserViewsQuery,
  validateSavedUserViewPayload,
} = require("../validation/userValidators");

function sanitizeUser(user) {
  if (!user) return null;
  const { pin, ...safeUser } = user;
  return safeUser;
}

function buildActorName(actor, fallback = "Roster Admin") {
  return String(actor?.fullName || actor?.staffId || fallback).trim();
}

function isOwnerActor(actor) {
  return String(actor?.role || "").trim() === "Owner";
}

async function recordDeniedWorkspaceAction({
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
      reason: String(reason || "Operation denied.").trim(),
      ...details,
    },
  });
}

async function assertOwnerWorkspaceControl(actor, action, entityType, entityId, reason) {
  if (isOwnerActor(actor)) {
    return;
  }

  const message = String(reason || "Owner access is required for this operation.").trim();
  await recordDeniedWorkspaceAction({
    actor,
    action,
    entityType,
    entityId,
    reason: message,
  });

  throw new AppError(403, message, {
    code: "OWNER_ROLE_REQUIRED",
  });
}

async function assertOwnerQuorum(targetUser, options = {}) {
  const currentRole = String(targetUser?.role || "").trim();
  const currentStatus = String(targetUser?.status || "").trim();
  const nextRole = String(options.nextRole || currentRole).trim() || currentRole;
  const nextStatus = String(options.nextStatus || currentStatus).trim() || currentStatus;
  const deleting = Boolean(options.deleting);

  const removesActiveOwnerCoverage =
    currentRole === "Owner" &&
    currentStatus === "Active" &&
    (deleting || nextRole !== "Owner" || nextStatus !== "Active");

  if (!removesActiveOwnerCoverage) {
    return;
  }

  const activeOwnerCount = await userRepository.countUsersByRole("Owner", {
    status: "Active",
  });

  if (activeOwnerCount <= 1) {
    throw new AppError(
      409,
      "The workspace must retain at least one active owner account.",
      {
        code: "LAST_ACTIVE_OWNER_REQUIRED",
      }
    );
  }
}

function csvEscape(value) {
  const normalized = String(value ?? "");
  return `"${normalized.replace(/"/g, '""')}"`;
}

async function getRequiredUser(id) {
  const existing = await userRepository.getUserById(id);

  if (!existing) {
    throw new AppError(404, "User not found.", {
      code: "USER_NOT_FOUND",
    });
  }

  return existing;
}

async function buildNextStaffId(role) {
  const users = await userRepository.getUsers();

  if (role === "Owner") {
    const maxOwnerId = users
      .map((user) => String(user.staffId || "").trim())
      .map((staffId) => /^ADMIN(\d{3,})$/.exec(staffId))
      .filter(Boolean)
      .reduce((max, match) => Math.max(max, Number(match[1] || 0)), 0);

    return `ADMIN${String(maxOwnerId + 1).padStart(3, "0")}`;
  }

  const maxAfrId = users
    .map((user) => String(user.staffId || "").trim())
    .map((staffId) => /^AFR-(\d{3,})$/.exec(staffId))
    .filter(Boolean)
    .reduce((max, match) => Math.max(max, Number(match[1] || 0)), 0);

  return `AFR-${String(maxAfrId + 1).padStart(3, "0")}`;
}

async function getUsers() {
  const users = await userRepository.getUsers();
  const hydratedUsers = await Promise.all(
    users.map(async (user) => ({
      ...sanitizeUser(user),
      oversight: (await userRepository.getUserOversight(user.id)).summary,
    }))
  );

  return hydratedUsers;
}

async function getUserById(id) {
  const existing = await getRequiredUser(id);
  const oversight = await userRepository.getUserOversight(existing.id);

  return {
    ...sanitizeUser(existing),
    oversight: oversight.summary,
  };
}

async function getUserAccessEvents(id) {
  const existing = await getRequiredUser(id);
  return userRepository.getUserAccessEvents(existing.id);
}

async function getUserOversight(id) {
  const existing = await getRequiredUser(id);
  return userRepository.getUserOversight(existing.id);
}

async function createUser(payload, actor) {
  await assertOwnerWorkspaceControl(
    actor,
    "users.create",
    "user",
    "pending:new",
    "Only an owner can create staff records."
  );
  const role = normalizeRole(payload?.role);

  if (!role) {
    throw new AppError(400, "A valid role is required.", {
      code: "VALIDATION_ERROR",
    });
  }

  const nextStaffId = await buildNextStaffId(role);
  const validated = validateUserPayload(payload, {
    nextStaffId,
  });
  const duplicate = await userRepository.getUserByStaffId(validated.staffId);

  if (duplicate) {
    throw new AppError(409, "A user with this staff ID already exists.", {
      code: "USER_STAFF_ID_CONFLICT",
    });
  }

  const invitedAt = new Date().toISOString();
  const createdUser = await userRepository.createUser(
    {
      id: await userRepository.getNextUserId(),
      staffId: validated.staffId,
      pin: "",
      fullName: validated.fullName,
      role: validated.role,
      department: validated.department,
      email: validated.email,
      phone: validated.phone,
      status: "Pending Approval",
      pinStatus: "Not Set",
      shiftAssignment:
        validated.shiftAssignment || getDefaultShiftForRole(validated.role),
      staffNotes: validated.staffNotes || "",
      incidentFlag: validated.incidentFlag || "Clear",
      incidentNote: validated.incidentNote || "",
      forcePinChange: false,
      isPinned: false,
      timetable: validated.timetable,
      invitedAt,
      approvedAt: null,
      approvedBy: "",
      pinUpdatedAt: null,
    },
    buildActorName(actor)
  );

  return sanitizeUser(createdUser);
}

async function updateUser(id, payload, actor) {
  await assertOwnerWorkspaceControl(
    actor,
    "users.update",
    "user",
    String(id),
    "Only an owner can update staff records."
  );
  const existing = await getRequiredUser(id);
  const role = normalizeRole(payload?.role ?? existing?.role);

  if (!role) {
    throw new AppError(400, "A valid role is required.", {
      code: "VALIDATION_ERROR",
    });
  }

  const validated = validateUserPayload(payload, {
    existing,
    nextStaffId: existing.staffId,
  });
  const duplicate = await userRepository.getUserByStaffId(validated.staffId);

  if (duplicate && String(duplicate.id) !== String(existing.id)) {
    throw new AppError(409, "A user with this staff ID already exists.", {
      code: "USER_STAFF_ID_CONFLICT",
    });
  }

  await assertOwnerQuorum(existing, {
    nextRole: validated.role,
  });

  const updatedUser = await userRepository.updateUser(
    existing.id,
    {
      ...existing,
      staffId: validated.staffId,
      fullName: validated.fullName,
      role: validated.role,
      department: validated.department,
      email: validated.email,
      phone: validated.phone,
      status: existing.status,
      pin: existing.pin,
      shiftAssignment: validated.shiftAssignment,
      staffNotes: validated.staffNotes,
      incidentFlag: validated.incidentFlag,
      incidentNote: validated.incidentNote,
      forcePinChange: existing.forcePinChange,
      isPinned: validated.isPinned,
      timetable: validated.timetable,
    },
    buildActorName(actor)
  );

  return sanitizeUser(updatedUser);
}

async function assignUserPin(id, payload, actor) {
  await assertOwnerWorkspaceControl(
    actor,
    "users.pin.assign",
    "user",
    String(id),
    "Only an owner can issue or reset staff PINs."
  );
  const existing = await getRequiredUser(id);
  const validated = validatePinAssignmentPayload(payload);
  const hashedPin = await bcrypt.hash(validated.pin, 10);
  const updatedUser = await userRepository.assignUserPin(
    existing.id,
    hashedPin,
    buildActorName(actor, "Owner")
  );

  return {
    user: sanitizeUser(updatedUser),
    wasReset: String(existing.pinStatus) === "Assigned",
  };
}

async function approveUser(id, actor) {
  await assertOwnerWorkspaceControl(
    actor,
    "users.access.approve",
    "user",
    String(id),
    "Only an owner can approve staff access."
  );
  const existing = await getRequiredUser(id);

  if (String(existing.pinStatus) !== "Assigned" || !String(existing.pin || "").trim()) {
    throw new AppError(400, "Assign a PIN before approving access.", {
      code: "PIN_REQUIRED_FOR_APPROVAL",
    });
  }

  const approvedUser = await userRepository.approveUserAccess(
    existing.id,
    buildActorName(actor, "Owner")
  );

  return sanitizeUser(approvedUser);
}

async function updateUserStatus(id, payload, actor) {
  await assertOwnerWorkspaceControl(
    actor,
    "users.status.update",
    "user",
    String(id),
    "Only an owner can change staff access status."
  );
  const existing = await getRequiredUser(id);
  const { status } = validateUserStatusPayload(payload);

  if (String(actor?.id) === String(existing.id) && status !== "Active") {
    throw new AppError(400, "You cannot deactivate your own account.", {
      code: "SELF_STATUS_CHANGE_NOT_ALLOWED",
    });
  }

  await assertOwnerQuorum(existing, {
    nextStatus: status,
  });

  if (status === "Active") {
    if (String(existing.pinStatus) !== "Assigned" || !String(existing.pin || "").trim()) {
      throw new AppError(400, "Assign a PIN before activating access.", {
        code: "PIN_REQUIRED_FOR_ACTIVATION",
      });
    }

    const activated = await userRepository.approveUserAccess(
      existing.id,
      buildActorName(actor, "Owner")
    );

    return sanitizeUser(activated);
  }

  if (status === "Pending Approval") {
    const pendingUser = await userRepository.updateUserAccessStatus(
      existing.id,
      status,
      buildActorName(actor, "Owner")
    );

    return sanitizeUser(pendingUser);
  }

  const updatedUser = await userRepository.updateUserAccessStatus(
    existing.id,
    status,
    buildActorName(actor, "Owner")
  );

  return sanitizeUser(updatedUser);
}

async function deleteUser(id, actor) {
  await assertOwnerWorkspaceControl(
    actor,
    "users.delete",
    "user",
    String(id),
    "Only an owner can delete staff accounts."
  );
  const target = await getRequiredUser(id);

  if (String(actor?.id) === String(target.id)) {
    throw new AppError(400, "You cannot delete your own account.", {
      code: "SELF_DELETE_NOT_ALLOWED",
    });
  }

  await assertOwnerQuorum(target, {
    deleting: true,
  });

  const deleted = await userRepository.deleteUser(id);
  return sanitizeUser(deleted);
}

async function updateUserWorkforceProfile(id, payload, actor) {
  await assertOwnerWorkspaceControl(
    actor,
    "users.workforce.update",
    "user",
    String(id),
    "Only an owner can change workforce profile controls."
  );
  const existing = await getRequiredUser(id);
  const validated = validateWorkforceProfilePayload(payload, existing);
  const updatedUser = await userRepository.updateUserWorkforceProfile(
    existing.id,
    validated,
    buildActorName(actor, "Owner")
  );

  return sanitizeUser(updatedUser);
}

async function exportUserAuditCsv() {
  const events = await userRepository.getAllUserAccessEvents(1000);
  const header = [
    "Created At",
    "Staff ID",
    "Full Name",
    "Event Type",
    "Severity",
    "Title",
    "Message",
    "Actor",
    "Session ID",
    "Source IP",
    "User Agent",
  ];
  const rows = events.map((event) => [
    event.createdAt,
    event.staffId,
    event.fullName,
    event.eventType,
    event.severity || "info",
    event.title,
    event.message,
    event.actorName,
    event.sessionId || "",
    event.sourceIp || "",
    event.userAgent || "",
  ]);

  return {
    filename: `afrospice-user-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    body: `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}`,
  };
}

async function exportSingleUserAuditCsv(id) {
  const existing = await getRequiredUser(id);
  const oversight = await userRepository.getUserOversight(existing.id);
  const header = [
    "Record Type",
    "Created At",
    "Staff ID",
    "Full Name",
    "State",
    "Severity",
    "Title",
    "Message",
    "Actor",
    "Session ID",
    "Source IP",
    "User Agent",
    "Login At",
    "Last Seen At",
    "Logout At",
    "Risk Level",
    "Anomaly Count",
  ];
  const eventRows = (oversight.events || []).map((event) => [
    "Access Event",
    event.createdAt,
    event.staffId,
    event.fullName,
    event.eventType,
    event.severity || "info",
    event.title,
    event.message,
    event.actorName,
    event.sessionId || "",
    event.sourceIp || "",
    event.userAgent || "",
    "",
    "",
    "",
    "",
    "",
  ]);
  const sessionRows = (oversight.sessions || []).map((session) => [
    "Session",
    session.loginAt,
    session.staffId,
    session.fullName,
    session.status,
    session.riskLevel || "normal",
    session.logoutAt ? "Closed session" : "Active session",
    session.logoutReason || session.loginReason || "Tracked staff session lifecycle.",
    "",
    session.id,
    session.lastSeenIp || session.loginIp || "",
    session.lastSeenUserAgent || session.loginUserAgent || "",
    session.loginAt,
    session.lastSeenAt,
    session.logoutAt || "",
    session.riskLevel || "normal",
    Number(session.anomalyCount || 0),
  ]);

  return {
    filename: `afrospice-user-audit-${String(existing.staffId || "staff").toLowerCase()}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`,
    body: `\uFEFF${[header, ...eventRows, ...sessionRows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n")}`,
  };
}

async function getSavedUserViews(actor, query) {
  const { pageKey } = validateSavedUserViewsQuery(query);
  const ownerUserId = Number(actor?.id || 0);
  return userRepository.getUserSavedViews(ownerUserId, pageKey);
}

async function saveUserView(actor, payload) {
  await assertOwnerWorkspaceControl(
    actor,
    "users.view.save",
    "user_saved_view",
    "pending:new",
    "Only an owner can save managed workforce views."
  );
  const ownerUserId = Number(actor?.id || 0);
  const { pageKey, name, config } = validateSavedUserViewPayload(payload);
  return userRepository.saveUserSavedView(ownerUserId, pageKey, name, config);
}

async function deleteSavedUserView(actor, viewId) {
  await assertOwnerWorkspaceControl(
    actor,
    "users.view.delete",
    "user_saved_view",
    String(viewId),
    "Only an owner can delete managed workforce views."
  );
  const ownerUserId = Number(actor?.id || 0);
  const deleted = await userRepository.deleteUserSavedView(viewId, ownerUserId);

  if (!deleted) {
    throw new AppError(404, "Saved view not found.", {
      code: "USER_VIEW_NOT_FOUND",
    });
  }

  return deleted;
}

module.exports = {
  getUsers,
  getUserById,
  getUserAccessEvents,
  getUserOversight,
  createUser,
  updateUser,
  assignUserPin,
  approveUser,
  updateUserStatus,
  deleteUser,
  updateUserWorkforceProfile,
  exportUserAuditCsv,
  exportSingleUserAuditCsv,
  getSavedUserViews,
  saveUserView,
  deleteSavedUserView,
};
