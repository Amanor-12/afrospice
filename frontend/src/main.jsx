import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AppErrorBoundary from "./components/AppErrorBoundary.jsx";
import { initializeMonitoring } from "./utils/monitoring.js";
import { installGlobalObservabilityHandlers } from "./utils/observability.js";

const shouldRedirectToCanonicalLocalhost =
  typeof window !== "undefined" && window.location.hostname === "127.0.0.1";

if (shouldRedirectToCanonicalLocalhost) {
  const targetUrl = new URL(window.location.href);
  targetUrl.hostname = "localhost";
  window.location.replace(targetUrl.toString());
} else {
  initializeMonitoring();
  installGlobalObservabilityHandlers();
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>
  );
}
