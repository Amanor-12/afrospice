import axios from "axios";
import { clearAuthSession, hasAuthSession } from "../utils/sessionStore";
import {
  BACKEND_RUNTIME_MISMATCH_CODE,
  buildBackendMismatchMessage,
  describeFeatureFromRoute,
  isLikelyBackendMismatch,
} from "../utils/backendRuntime";

const CONFIGURED_BASE_URL = import.meta.env.VITE_API_URL || "";
const DEFAULT_BASE_URL = "/api";
const BASE_URL = CONFIGURED_BASE_URL || DEFAULT_BASE_URL;

const DEV_BASE_URL_CANDIDATES = [
  BASE_URL,
  "http://localhost:5000/api",
].filter((value, index, collection) => Boolean(value) && collection.indexOf(value) === index);

let activeBaseUrl = BASE_URL;

function resolveFallbackBaseUrl(currentBaseUrl) {
  const normalizedCurrent = String(currentBaseUrl || "").trim();
  return (
    DEV_BASE_URL_CANDIDATES.find((candidate) => candidate !== normalizedCurrent) || null
  );
}

function isAuthBootstrapRequest(config) {
  const requestMethod = String(config?.method || "").trim().toLowerCase();
  const requestUrl = String(config?.url || "").trim().toLowerCase();

  if (requestMethod !== "post") {
    return false;
  }

  return ["/auth/login", "/auth/passkey-login/options", "/auth/passkey-login/verify"].includes(
    requestUrl
  );
}

function buildBackendUnavailableMessage() {
  return `Cannot reach backend API. Tried: ${DEV_BASE_URL_CANDIDATES.join(", ")}. Start the workspace with "C:\\Users\\regan\\Downloads\\afrospice\\start-afrospice.cmd" or run "npm.cmd run dev" in C:\\Users\\regan\\Downloads\\afrospice\\backend.`;
}

function hasAuthorizationHeader(headers) {
  if (!headers) return false;

  const directValue =
    headers.Authorization ||
    headers.authorization ||
    (typeof headers.get === "function" ? headers.get("Authorization") : "");

  return Boolean(String(directValue || "").trim());
}

function canRetryAgainstFallback(config) {
  const requestMethod = String(config?.method || "get").trim().toLowerCase();
  const requestUrl = String(config?.url || "").trim().toLowerCase();
  const isIdempotentRequest = ["get", "head", "options"].includes(requestMethod);
  const isAuthBootstrapMutation =
    requestMethod === "post" &&
    ["/auth/login", "/auth/passkey-login/options", "/auth/passkey-login/verify"].includes(
      requestUrl
    );
  const hasActiveSession = hasAuthSession();
  const carriesAuthorization = hasAuthorizationHeader(config?.headers);

  return (isIdempotentRequest || isAuthBootstrapMutation) && !hasActiveSession && !carriesAuthorization;
}

const API = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

API.interceptors.request.use(
  (config) => {
    config.baseURL = activeBaseUrl;
    return config;
  },
  (error) => Promise.reject(error)
);

API.interceptors.response.use(
  (response) => {
    if (response?.config?.baseURL) {
      activeBaseUrl = response.config.baseURL;
    }
    return response;
  },
  (error) => {
    const originalConfig = error?.config || {};

    if (
      !error?.response &&
      import.meta.env.DEV &&
      !originalConfig.__afrospiceBaseRetried &&
      canRetryAgainstFallback(originalConfig)
    ) {
      const fallbackBaseUrl = resolveFallbackBaseUrl(originalConfig.baseURL || activeBaseUrl);
      if (fallbackBaseUrl) {
        activeBaseUrl = fallbackBaseUrl;
        originalConfig.__afrospiceBaseRetried = true;
        originalConfig.baseURL = fallbackBaseUrl;
        return API(originalConfig);
      }
    }

    if (!error?.response) {
      return Promise.reject({
        status: 503,
        message: buildBackendUnavailableMessage(),
        data: null,
        response: null,
        originalError: error,
      });
    }

    const status = error?.response?.status;
    if (
      import.meta.env.DEV &&
      status === 502 &&
      !originalConfig.__afrospiceBaseRetried &&
      canRetryAgainstFallback(originalConfig)
    ) {
      const fallbackBaseUrl = resolveFallbackBaseUrl(originalConfig.baseURL || activeBaseUrl);
      if (fallbackBaseUrl) {
        activeBaseUrl = fallbackBaseUrl;
        originalConfig.__afrospiceBaseRetried = true;
        originalConfig.baseURL = fallbackBaseUrl;
        return API(originalConfig);
      }
    }

    const backendUnavailable502 =
      import.meta.env.DEV &&
      status === 502 &&
      (isAuthBootstrapRequest(originalConfig) || canRetryAgainstFallback(originalConfig));
    const backendMismatch = isLikelyBackendMismatch(error, {
      route: originalConfig?.url || "",
    });

    const message =
      (backendUnavailable502 ? buildBackendUnavailableMessage() : "") ||
      (backendMismatch
        ? buildBackendMismatchMessage(describeFeatureFromRoute(originalConfig?.url || ""))
        : "") ||
      error?.response?.data?.message ||
      error?.message ||
      "Unexpected error occurred.";

    if (status === 401) {
      clearAuthSession();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("afrospice:logout"));
      }

      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    return Promise.reject({
      status: status || 500,
      message,
      code: backendMismatch
        ? BACKEND_RUNTIME_MISMATCH_CODE
        : error?.response?.data?.code || null,
      data: error?.response?.data || null,
      response: error?.response || null,
      originalError: error,
    });
  }
);

export default API;
