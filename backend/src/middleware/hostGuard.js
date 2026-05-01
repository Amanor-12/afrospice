const AppError = require("../errors/AppError");
const runtime = require("../config/runtime");

function normalizeHostname(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
}

function parseHostHeader(value = "") {
  const candidate = String(value || "")
    .split(",")[0]
    .trim();

  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(`http://${candidate}`);
    const hostname = normalizeHostname(parsed.hostname);

    if (!hostname) {
      return null;
    }

    const port = parsed.port ? Number(parsed.port) : null;
    return {
      hostname,
      port: Number.isFinite(port) ? port : null,
    };
  } catch {
    return null;
  }
}

function isHostAllowed(candidate) {
  if (!candidate || !runtime.hostValidationEnabled) {
    return true;
  }

  return runtime.requestHostAllowlist.some((allowedHost) => {
    if (allowedHost.hostname !== candidate.hostname) {
      return false;
    }

    if (!Number.isFinite(allowedHost.port)) {
      return true;
    }

    return allowedHost.port === candidate.port;
  });
}

function hostGuard(req, _res, next) {
  if (!runtime.hostValidationEnabled) {
    return next();
  }

  const forwardedHost =
    runtime.trustProxy !== false ? String(req.headers["x-forwarded-host"] || "").trim() : "";
  const directHost = String(req.headers.host || "").trim();
  const candidate = parseHostHeader(forwardedHost || directHost);

  if (!candidate) {
    return next();
  }

  if (isHostAllowed(candidate)) {
    return next();
  }

  return next(
    new AppError(400, "Request host is not allowed for this environment.", {
      code: "HOST_NOT_ALLOWED",
      details: {
        hostname: candidate.hostname,
        port: candidate.port,
      },
    })
  );
}

module.exports = hostGuard;
