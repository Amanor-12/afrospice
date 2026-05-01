const AFROSPICE_SERVICE_ID = "workspace-api";
const BACKEND_RUNTIME_MISMATCH_CODE = "BACKEND_RUNTIME_MISMATCH";
const WORKSPACE_RECOVERY_GUIDANCE =
  'Start the workspace with "C:\\Users\\regan\\Downloads\\afrospice\\start-afrospice.cmd" or run "npm.cmd run dev" in C:\\Users\\regan\\Downloads\\afrospice\\backend.';

const ROUTES_WITH_STRICT_RUNTIME_SHAPE = new Set([
  "/auth/login",
  "/auth/passkey-login/options",
  "/auth/passkey-login/verify",
  "/reports/owner-assistant",
  "/reports/notifications",
]);

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeRoute(value = "") {
  return `/${String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase()}`;
}

function readResponseData(error) {
  return error?.data || error?.response?.data || null;
}

function readResponseHeaders(error) {
  return error?.response?.headers || {};
}

function readStatus(error) {
  return Number(error?.status || error?.response?.status || 0);
}

function readFieldErrors(error) {
  const data = readResponseData(error);
  return Array.isArray(data?.errors) ? data.errors : [];
}

function hasAfroSpiceSignature(error) {
  return normalizeText(readResponseHeaders(error)?.["x-afrospice-service"]) === AFROSPICE_SERVICE_ID;
}

function hasForeignCredentialShape(error) {
  const fields = new Set(
    readFieldErrors(error).map((entry) => normalizeText(entry?.field))
  );

  return fields.has("email") && fields.has("password");
}

function isMissingRoute(error) {
  return (
    readStatus(error) === 404 &&
    /route not found/i.test(
      String(readResponseData(error)?.message || error?.message || "")
    )
  );
}

export function describeFeatureFromRoute(route = "") {
  const normalizedRoute = normalizeRoute(route);

  if (normalizedRoute === "/auth/login") {
    return "sign-in";
  }

  if (
    normalizedRoute === "/auth/passkey-login/options" ||
    normalizedRoute === "/auth/passkey-login/verify"
  ) {
    return "fingerprint sign-in";
  }

  if (normalizedRoute === "/reports/owner-assistant") {
    return "the owner assistant";
  }

  if (normalizedRoute === "/reports/notifications") {
    return "workspace notifications";
  }

  return "this feature";
}

export function buildBackendMismatchMessage(feature = "this feature") {
  const normalizedFeature = String(feature || "this feature").trim();
  return `The running backend is not the current AfroSpice API for ${normalizedFeature}. ${WORKSPACE_RECOVERY_GUIDANCE}`;
}

export function isLikelyBackendMismatch(error, options = {}) {
  const route = normalizeRoute(options?.route || error?.config?.url || error?.response?.config?.url);

  if (route === "/auth/login" && hasForeignCredentialShape(error)) {
    return true;
  }

  if (hasAfroSpiceSignature(error)) {
    return false;
  }

  return Boolean(route && ROUTES_WITH_STRICT_RUNTIME_SHAPE.has(route) && isMissingRoute(error));
}

export { AFROSPICE_SERVICE_ID, BACKEND_RUNTIME_MISMATCH_CODE };
