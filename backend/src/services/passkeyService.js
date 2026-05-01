const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} = require("@simplewebauthn/server");

const AppError = require("../errors/AppError");
const auditLogService = require("./auditLogService");
const authRepository = require("../data/repositories/authRepository");
const models = require("../data/models");
const { signToken } = require("../utils/jwt");
const { updateRequestContext, getRequestContext } = require("../utils/requestContextStore");
const { nextSequence } = require("../data/repositories/mongoRepositoryUtils");
const { setChallenge, consumeChallenge } = require("../utils/passkeyChallengeStore");
const {
  validatePasskeyIdentifierPayload,
  validatePasskeyRegistrationPayload,
  validatePasskeyAuthenticationPayload,
} = require("../validation/authValidators");

const COUNTER_KEYS = {
  userPasskey: "user_passkey_id",
};

function sanitizeUser(user) {
  if (!user) return null;
  const { pin, ...safeUser } = user;
  return safeUser;
}

function resolveExpectedOrigin(origin = "") {
  const candidate = String(
    origin || process.env.PUBLIC_BASE_URL || process.env.FRONTEND_ORIGIN?.split(",")[0] || "http://localhost:5173"
  )
    .trim()
    .replace(/\/$/, "");

  try {
    const url = new URL(candidate);
    if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
    }
    return url.origin;
  } catch {
    return "http://localhost:5173";
  }
}

function resolveRpId(origin = "") {
  try {
    return new URL(resolveExpectedOrigin(origin)).hostname;
  } catch {
    return "localhost";
  }
}

function normalizeChallengeIdentifier(identifier = "") {
  return String(identifier || "").trim().toLowerCase();
}

function normalizeLoopbackIp(address = "") {
  const normalized = String(address || "").trim().toLowerCase();
  if (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:127.0.0.1")
  ) {
    return "loopback";
  }

  return normalized;
}

function buildChallengeContext() {
  const requestContext = getRequestContext();
  return {
    sourceIp: normalizeLoopbackIp(requestContext?.sourceIp),
    userAgent: String(requestContext?.userAgent || "").trim(),
  };
}

function assertChallengeContext(challenge = {}, actionLabel = "Passkey request") {
  const currentContext = buildChallengeContext();

  if (
    challenge?.sourceIp &&
    currentContext.sourceIp &&
    String(challenge.sourceIp) !== String(currentContext.sourceIp)
  ) {
    throw new AppError(400, `${actionLabel} context changed. Start again.`, {
      code: "PASSKEY_CONTEXT_CHANGED",
    });
  }

  if (
    challenge?.userAgent &&
    currentContext.userAgent &&
    String(challenge.userAgent) !== String(currentContext.userAgent)
  ) {
    throw new AppError(400, `${actionLabel} context changed. Start again.`, {
      code: "PASSKEY_CONTEXT_CHANGED",
    });
  }
}

function buildRegistrationKey(userId) {
  return `registration:${Number(userId || 0)}`;
}

function buildAuthenticationKey(identifier) {
  return `authentication:${normalizeChallengeIdentifier(identifier)}`;
}

async function resolveAuthenticationUser(identifier = "") {
  const normalizedIdentifier = String(identifier || "").trim();
  const user = normalizedIdentifier
    ? await authRepository.getUserByIdentifier(normalizedIdentifier)
    : await authRepository.getPrimaryOwnerUser();

  return {
    user,
    identifier: String(normalizedIdentifier || user?.staffId || "").trim(),
  };
}

function toWebAuthnUserId(value) {
  return Buffer.from(String(value ?? "").trim(), "utf8");
}

function normalizePasskey(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    userId: Number(row.userId || 0),
    staffId: String(row.staffId || "").trim(),
    label: String(row.label || "Platform Authenticator").trim() || "Platform Authenticator",
    credentialId: String(row.credentialId || "").trim(),
    counter: Number(row.counter || 0),
    transports: Array.isArray(row.transports) ? row.transports : [],
    deviceType: String(row.deviceType || "singleDevice").trim() || "singleDevice",
    backedUp: Boolean(row.backedUp),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
  };
}

async function listUserPasskeys(userId) {
  const rows = await models.UserPasskey.find({ userId: Number(userId) }).sort({ createdAt: -1 }).lean();
  return rows.map(normalizePasskey);
}

async function assertPasskeyActor(userContext) {
  const user = await authRepository.getUserById(userContext?.id);
  if (!user) {
    throw new AppError(404, "User not found.", {
      code: "USER_NOT_FOUND",
    });
  }

  if (String(user.status || "").trim() === "Pending Approval") {
    throw new AppError(403, "This staff record is waiting for owner approval.", {
      code: "ACCOUNT_NOT_READY",
    });
  }

  if (String(user.status || "").trim() !== "Active") {
    throw new AppError(403, "This user account is inactive.", {
      code: "ACCOUNT_NOT_READY",
    });
  }

  return user;
}

function getRegistrationCredentialInfo(registrationInfo = {}) {
  if (registrationInfo?.credential) {
    return {
      id:
        typeof registrationInfo.credential.id === "string"
          ? registrationInfo.credential.id
          : Buffer.from(registrationInfo.credential.id).toString("base64url"),
      publicKey: Buffer.from(registrationInfo.credential.publicKey).toString("base64url"),
      counter: Number(registrationInfo.credential.counter || 0),
      transports: Array.isArray(registrationInfo.credential.transports)
        ? registrationInfo.credential.transports
        : [],
    };
  }

  return {
    id:
      typeof registrationInfo.credentialID === "string"
        ? registrationInfo.credentialID
        : Buffer.from(registrationInfo.credentialID || "").toString("base64url"),
    publicKey: Buffer.from(registrationInfo.credentialPublicKey || "").toString("base64url"),
    counter: Number(registrationInfo.counter || 0),
    transports: [],
  };
}

async function beginPasskeyRegistration(userContext, payload = {}, origin = "") {
  const user = await assertPasskeyActor(userContext);
  const { label } = validatePasskeyRegistrationPayload(payload);
  const expectedOrigin = resolveExpectedOrigin(origin);
  const rpID = resolveRpId(expectedOrigin);
  const existingPasskeys = await listUserPasskeys(user.id);

  const options = await generateRegistrationOptions({
    rpName: "AfroSpice",
    rpID,
    userID: toWebAuthnUserId(user.id),
    userName: user.email || user.staffId,
    userDisplayName: user.fullName || user.staffId,
    timeout: 60000,
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: existingPasskeys.map((item) => ({
      id: item.credentialId,
      transports: item.transports,
    })),
  });

  setChallenge(buildRegistrationKey(user.id), {
    kind: "registration",
    challenge: options.challenge,
    expectedOrigin,
    rpID,
    label: label || "Platform Authenticator",
    ...buildChallengeContext(),
  });

  return {
    options,
    passkeys: existingPasskeys,
  };
}

async function finishPasskeyRegistration(userContext, payload = {}, origin = "") {
  const user = await assertPasskeyActor(userContext);
  const { response, label } = validatePasskeyRegistrationPayload(payload);
  const challenge = consumeChallenge(buildRegistrationKey(user.id), "registration");

  if (!response) {
    throw new AppError(400, "A valid passkey response is required.", {
      code: "PASSKEY_RESPONSE_REQUIRED",
    });
  }

  if (!challenge) {
    throw new AppError(400, "Passkey registration has expired. Start again.", {
      code: "PASSKEY_REGISTRATION_EXPIRED",
    });
  }

  assertChallengeContext(challenge, "Passkey registration");

  let verification = null;

  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.expectedOrigin || resolveExpectedOrigin(origin),
      expectedRPID: challenge.rpID || resolveRpId(origin),
      requireUserVerification: true,
    });
  } catch (error) {
    throw new AppError(400, error.message || "Passkey registration could not be verified.", {
      code: "PASSKEY_REGISTRATION_INVALID",
    });
  }

  if (!verification?.verified || !verification.registrationInfo) {
    throw new AppError(400, "Passkey registration could not be verified.", {
      code: "PASSKEY_REGISTRATION_INVALID",
    });
  }

  const credential = getRegistrationCredentialInfo(verification.registrationInfo);
  const existingPasskey = await models.UserPasskey.findOne({
    credentialId: credential.id,
  }).lean();
  const now = new Date();

  if (existingPasskey && Number(existingPasskey.userId) !== Number(user.id)) {
    throw new AppError(409, "This passkey is already linked to another staff account.", {
      code: "PASSKEY_ALREADY_REGISTERED",
    });
  }

  if (existingPasskey) {
    await models.UserPasskey.updateOne(
      { credentialId: credential.id },
      {
        $set: {
          label: String(label || challenge.label || existingPasskey.label || "Platform Authenticator").trim(),
          publicKey: credential.publicKey,
          counter: credential.counter,
          transports: Array.isArray(response?.response?.transports)
            ? response.response.transports
            : Array.isArray(credential.transports)
            ? credential.transports
            : [],
          deviceType: String(
            verification.registrationInfo.credentialDeviceType ||
              verification.registrationInfo.credential?.deviceType ||
              existingPasskey.deviceType ||
              "singleDevice"
          ).trim(),
          backedUp: Boolean(
            verification.registrationInfo.credentialBackedUp ||
              verification.registrationInfo.credential?.backedUp ||
              existingPasskey.backedUp
          ),
          updatedAt: now,
        },
      }
    );
  } else {
    const id = await nextSequence(COUNTER_KEYS.userPasskey);
    await models.UserPasskey.create({
      id,
      userId: Number(user.id),
      staffId: String(user.staffId || "").trim(),
      label: String(label || challenge.label || "Platform Authenticator").trim(),
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: Array.isArray(response?.response?.transports)
        ? response.response.transports
        : Array.isArray(credential.transports)
        ? credential.transports
        : [],
      deviceType: String(
        verification.registrationInfo.credentialDeviceType ||
          verification.registrationInfo.credential?.deviceType ||
          "singleDevice"
      ).trim(),
      backedUp: Boolean(
        verification.registrationInfo.credentialBackedUp ||
          verification.registrationInfo.credential?.backedUp
      ),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    });
  }

  await auditLogService.recordAuditEvent({
    actor: userContext,
    action: "auth.passkey_registered",
    entityType: "user",
    entityId: String(user.id),
    details: {
      label: String(label || challenge.label || "Platform Authenticator").trim(),
      credentialId: credential.id,
    },
  });

  return {
    passkeys: await listUserPasskeys(user.id),
  };
}

async function beginPasskeyAuthentication(payload = {}, origin = "") {
  const { identifier } = validatePasskeyIdentifierPayload(payload);
  const resolved = await resolveAuthenticationUser(identifier);
  const user = resolved.user;
  const lookupIdentifier = resolved.identifier;

  if (!user) {
    throw new AppError(404, "No matching owner account was found.", {
      code: "PASSKEY_USER_NOT_FOUND",
    });
  }

  const passkeys = await listUserPasskeys(user.id);
  if (!passkeys.length) {
    throw new AppError(404, "No passkeys are enrolled for this staff account.", {
      code: "PASSKEY_NOT_ENROLLED",
    });
  }

  const expectedOrigin = resolveExpectedOrigin(origin);
  const rpID = resolveRpId(expectedOrigin);

  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60000,
    userVerification: "required",
    allowCredentials: passkeys.map((item) => ({
      id: item.credentialId,
      transports: item.transports,
    })),
  });

  setChallenge(buildAuthenticationKey(lookupIdentifier), {
    kind: "authentication",
    challenge: options.challenge,
    expectedOrigin,
    rpID,
    userId: user.id,
    identifier: lookupIdentifier,
    ...buildChallengeContext(),
  });

  return {
    options,
  };
}

function getPasskeyAccessBlockMessage(user) {
  if (String(user?.status || "").trim() === "Pending Approval") {
    return "This staff record is waiting for owner approval.";
  }

  if (String(user?.status || "").trim() !== "Active") {
    return "This user account is inactive.";
  }

  return "";
}

async function finishPasskeyAuthentication(payload = {}, origin = "") {
  const requestContext = getRequestContext();
  const { identifier, response } = validatePasskeyAuthenticationPayload(payload);
  const resolved = await resolveAuthenticationUser(identifier);
  const lookupIdentifier = resolved.identifier;
  const challenge = consumeChallenge(buildAuthenticationKey(lookupIdentifier), "authentication");

  if (!challenge) {
    throw new AppError(400, "Passkey sign-in request expired. Start again.", {
      code: "PASSKEY_AUTH_EXPIRED",
    });
  }

  assertChallengeContext(challenge, "Passkey sign-in");

  const credentialId = String(response?.id || "").trim();
  if (!credentialId) {
    throw new AppError(400, "A valid passkey credential is required.", {
      code: "PASSKEY_CREDENTIAL_REQUIRED",
    });
  }

  const passkeyRow = await models.UserPasskey.findOne({ credentialId }).lean();
  if (!passkeyRow || Number(passkeyRow.userId) !== Number(challenge.userId)) {
    await authRepository.recordUserLoginFailure(lookupIdentifier, "Passkey login failed.");
    throw new AppError(401, "Passkey login failed.", {
      code: "PASSKEY_AUTH_INVALID",
    });
  }

  const user = await authRepository.getUserById(challenge.userId);
  if (!user) {
    throw new AppError(404, "User not found.", {
      code: "USER_NOT_FOUND",
    });
  }

  const accessBlockMessage = getPasskeyAccessBlockMessage(user);
  if (accessBlockMessage) {
    await authRepository.recordUserLoginFailure(lookupIdentifier, accessBlockMessage);
    throw new AppError(403, accessBlockMessage, {
      code: "ACCOUNT_NOT_READY",
    });
  }

  let verification = null;

  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.expectedOrigin || resolveExpectedOrigin(origin),
      expectedRPID: challenge.rpID || resolveRpId(origin),
      authenticator: {
        credentialID: passkeyRow.credentialId,
        credentialPublicKey: Buffer.from(String(passkeyRow.publicKey || ""), "base64url"),
        counter: Number(passkeyRow.counter || 0),
        transports: Array.isArray(passkeyRow.transports) ? passkeyRow.transports : [],
      },
      requireUserVerification: true,
    });
  } catch (error) {
    await authRepository.recordUserLoginFailure(lookupIdentifier, error.message || "Passkey login failed.");
    throw new AppError(401, error.message || "Passkey login failed.", {
      code: "PASSKEY_AUTH_INVALID",
    });
  }

  if (!verification?.verified) {
    await authRepository.recordUserLoginFailure(lookupIdentifier, "Passkey login failed.");
    throw new AppError(401, "Passkey login failed.", {
      code: "PASSKEY_AUTH_INVALID",
    });
  }

  const now = new Date();
  const newCounter = Number(
    verification.authenticationInfo?.newCounter ??
      verification.authenticationInfo?.credential?.counter ??
      passkeyRow.counter
  );

  await models.UserPasskey.updateOne(
    { credentialId: passkeyRow.credentialId },
    {
      $set: {
        counter: newCounter,
        lastUsedAt: now,
        updatedAt: now,
      },
    }
  );

  const session = await authRepository.createUserSession(user, {
    loginReason: "Passkey sign-in",
    sourceIp: requestContext?.sourceIp,
    userAgent: requestContext?.userAgent,
  });

  const token = signToken({
    id: user.id,
    staffId: user.staffId,
    role: user.role,
    fullName: user.fullName,
    sessionId: session?.id || "",
  });

  updateRequestContext({
    actorUserId: user.id ?? null,
    actorStaffId: String(user.staffId || "").trim(),
    actorName: String(user.fullName || user.staffId || "").trim(),
    actorRole: String(user.role || "").trim(),
    sessionId: String(session?.id || "").trim(),
  });

  await auditLogService.recordAuditEvent({
    actor: {
      id: user.id,
      staffId: user.staffId,
      fullName: user.fullName,
    },
    action: "auth.passkey_login",
    entityType: "user",
    entityId: String(user.id),
    details: {
      credentialId: passkeyRow.credentialId,
    },
  });

  return {
    token,
    user: sanitizeUser(user),
  };
}

async function removePasskey(userContext, credentialId) {
  const user = await assertPasskeyActor(userContext);
  const normalizedCredentialId = String(credentialId || "").trim();

  if (!normalizedCredentialId) {
    throw new AppError(400, "A valid passkey credential is required.", {
      code: "PASSKEY_CREDENTIAL_REQUIRED",
    });
  }

  const existing = await models.UserPasskey.findOne({
    credentialId: normalizedCredentialId,
    userId: Number(user.id),
  }).lean();

  if (!existing) {
    throw new AppError(404, "Passkey not found.", {
      code: "PASSKEY_NOT_FOUND",
    });
  }

  await models.UserPasskey.deleteOne({
    credentialId: normalizedCredentialId,
    userId: Number(user.id),
  });

  await auditLogService.recordAuditEvent({
    actor: userContext,
    action: "auth.passkey_removed",
    entityType: "user",
    entityId: String(user.id),
    details: {
      credentialId: normalizedCredentialId,
      label: String(existing.label || "").trim(),
    },
  });

  return {
    passkeys: await listUserPasskeys(user.id),
  };
}

module.exports = {
  listUserPasskeys,
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  beginPasskeyAuthentication,
  finishPasskeyAuthentication,
  removePasskey,
};
