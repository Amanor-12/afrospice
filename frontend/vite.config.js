import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function resolveManualChunk(id = "") {
  if (!id.includes("node_modules")) {
    return undefined;
  }

  if (id.includes("recharts") || id.includes("\\d3-") || id.includes("/d3-")) {
    return "charts";
  }

  if (id.includes("react-router")) {
    return "routing";
  }

  if (id.includes("@sentry")) {
    return "monitoring";
  }

  if (id.includes("react-icons")) {
    return "icons";
  }

  if (id.includes("axios")) {
    return "network";
  }

  if (id.includes("react") || id.includes("scheduler")) {
    return "react-vendor";
  }

  return "vendor";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    plugins: [react()],
    build: {
      sourcemap: mode === "production" ? "hidden" : false,
      rollupOptions: {
        output: {
          manualChunks: resolveManualChunk,
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.VITE_BACKEND_URL || "http://localhost:5000",
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: true,
    },
  };
});
