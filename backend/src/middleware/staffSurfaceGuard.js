const AppError = require("../errors/AppError");

const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);
const LOOPBACK_ORIGIN_PATTERN =
  /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;

function normalizeOrigin(value = "") {
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

function staffSurfaceGuard(req, _res, next) {
  const fetchSite = String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
  const origin = normalizeOrigin(req.headers.origin);
  const refererOrigin = normalizeOrigin(req.headers.referer);
  const requestOrigin = origin || refererOrigin;

  if (requestOrigin && LOOPBACK_ORIGIN_PATTERN.test(requestOrigin)) {
    return next();
  }

  if (ALLOWED_FETCH_SITES.has(fetchSite)) {
    return next();
  }

  return next(
    new AppError(403, "Staff workspace requests must come from the local application surface.", {
      code: "STAFF_SURFACE_ORIGIN_REJECTED",
    })
  );
}

module.exports = staffSurfaceGuard;
