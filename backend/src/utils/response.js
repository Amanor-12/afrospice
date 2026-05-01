const { buildRequestMeta } = require("./requestContextStore");

function mergeResponseMeta(res, extraMeta = null) {
  const requestMeta = buildRequestMeta(res.locals?.requestContext || null) || {};
  const normalizedExtra =
    extraMeta && typeof extraMeta === "object" && !Array.isArray(extraMeta) ? extraMeta : {};
  const mergedMeta = {
    ...requestMeta,
    ...normalizedExtra,
  };

  return Object.keys(mergedMeta).length > 0 ? mergedMeta : null;
}

function success(res, data = {}, message = "Success", status = 200, extraMeta = null) {
  const meta = mergeResponseMeta(res, extraMeta);
  return res.status(status).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  });
}

function created(res, data = {}, message = "Created", extraMeta = null) {
  return success(res, data, message, 201, extraMeta);
}

function fail(res, message = "Error", status = 500, extra = {}) {
  const normalizedExtra = extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
  const meta = mergeResponseMeta(res, normalizedExtra.meta);

  return res.status(status).json({
    success: false,
    message,
    ...Object.fromEntries(Object.entries(normalizedExtra).filter(([key]) => key !== "meta")),
    ...(meta ? { meta } : {}),
  });
}

module.exports = {
  success,
  created,
  fail,
  mergeResponseMeta,
};
