const AppError = require("../errors/AppError");
const runtime = require("../config/runtime");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOOPBACK_ORIGIN_PATTERN =
  /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;
const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none", ""]);

function normalizeOriginFromHeader(value = "") {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return "";
  }

  try {
    return new URL(candidate).origin;
  } catch {
    return "";
  }
}

function isAllowedOrigin(origin = "") {
  if (!origin) {
    return false;
  }

  if (runtime.allowedOrigins.includes(origin)) {
    return true;
  }

  return runtime.isDevelopment && LOOPBACK_ORIGIN_PATTERN.test(origin);
}

function browserMutationGuard(req, _res, next) {
  const method = String(req.method || "").trim().toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return next();
  }

  const fetchSite = String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
  if (!ALLOWED_FETCH_SITES.has(fetchSite)) {
    return next(
      new AppError(403, "Cross-site browser mutations are not allowed.", {
        code: "BROWSER_MUTATION_BLOCKED",
      })
    );
  }

  const origin = normalizeOriginFromHeader(req.headers.origin);
  const refererOrigin = normalizeOriginFromHeader(req.headers.referer);
  const requestOrigin = origin || refererOrigin;

  if (!requestOrigin) {
    return next();
  }

  if (!isAllowedOrigin(requestOrigin)) {
    return next(
      new AppError(403, "Browser origin is not allowed for authenticated mutations.", {
        code: "BROWSER_ORIGIN_REJECTED",
      })
    );
  }

  return next();
}

module.exports = browserMutationGuard;
