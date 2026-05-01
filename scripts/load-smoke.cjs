const http = require("http");
const { performance } = require("perf_hooks");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const backendEntryPath = path.join(backendDir, "server.js");
const baseUrl = String(process.env.LOAD_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const scenario = String(process.env.LOAD_SCENARIO || "public").trim().toLowerCase();
const ownerPin = String(process.env.LOAD_OWNER_PIN || "").trim();
const ownerCookie = String(process.env.LOAD_OWNER_COOKIE || "").trim();
const virtualUsers = readBoundedInteger(process.env.LOAD_USERS, 6, {
  min: 1,
  max: 1000,
});
const iterations = readBoundedInteger(process.env.LOAD_ITERATIONS, 4, {
  min: 1,
  max: 1000,
});
const requestTimeoutMs = readBoundedInteger(process.env.LOAD_TIMEOUT_MS, 15000, {
  min: 1000,
  max: 120000,
});
const maxP95Ms = Number.isFinite(Number(process.env.LOAD_MAX_P95_MS))
  ? Number(process.env.LOAD_MAX_P95_MS)
  : null;
const maxP99Ms = Number.isFinite(Number(process.env.LOAD_MAX_P99_MS))
  ? Number(process.env.LOAD_MAX_P99_MS)
  : null;
const reuseOwnerSession =
  String(process.env.LOAD_OWNER_SESSION_REUSE || "false").trim().toLowerCase() === "true";

function readBoundedInteger(rawValue, fallbackValue, options = {}) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  const minimum = Number.isFinite(options.min) ? Number(options.min) : Number.MIN_SAFE_INTEGER;
  const maximum = Number.isFinite(options.max) ? Number(options.max) : Number.MAX_SAFE_INTEGER;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestStatus(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(Number(response.statusCode || 0));
    });

    request.on("timeout", () => {
      request.destroy();
      resolve(0);
    });

    request.on("error", () => {
      resolve(0);
    });
  });
}

async function waitForBackend(maxAttempts = 60) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await requestStatus(`${baseUrl}/api/system/health`);
    if (status >= 200 && status < 500) {
      return true;
    }
    await wait(500);
  }

  return false;
}

function spawnBackend() {
  return spawn(process.execPath, [backendEntryPath], {
    cwd: backendDir,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeSetCookie(headers) {
  const rawCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
      ? [headers.get("set-cookie")]
      : [];

  return rawCookies
    .map((entry) => String(entry || "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function request(label, url, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const text = await response.text();
  const latencyMs = Number((performance.now() - startedAt).toFixed(1));

  return {
    label,
    status: response.status,
    ok: response.ok,
    json: parseJsonSafe(text),
    cookie: normalizeSetCookie(response.headers),
    latencyMs,
  };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function ensureEndpointMetric(metrics, label) {
  if (!metrics.endpointStats[label]) {
    metrics.endpointStats[label] = {
      count: 0,
      latencies: [],
      statusCodes: {},
    };
  }

  return metrics.endpointStats[label];
}

function recordResponse(metrics, response, options = {}) {
  metrics.latencies.push(response.latencyMs);
  metrics.statusCodes[response.status] = (metrics.statusCodes[response.status] || 0) + 1;

  const endpointMetric = ensureEndpointMetric(metrics, response.label);
  endpointMetric.count += 1;
  endpointMetric.latencies.push(response.latencyMs);
  endpointMetric.statusCodes[response.status] = (endpointMetric.statusCodes[response.status] || 0) + 1;

  if (!response.ok && !options.allowFailure) {
    metrics.failures.push(`${response.label} returned ${response.status}`);
  }
}

async function runPublicScenario(metrics) {
  const endpoints = [
    { label: "GET /api/system/health", url: `${baseUrl}/api/system/health` },
    { label: "GET /api/system/readiness", url: `${baseUrl}/api/system/readiness` },
  ];

  for (const endpoint of endpoints) {
    const response = await request(endpoint.label, endpoint.url);
    recordResponse(metrics, response, {
      allowFailure: endpoint.label.endsWith("/readiness") && response.status === 503,
    });
  }
}

async function authenticateOwner(metrics) {
  if (!ownerPin && !ownerCookie) {
    throw new Error("LOAD_OWNER_PIN or LOAD_OWNER_COOKIE must be set to run the owner scenario.");
  }

  if (ownerCookie) {
    return ownerCookie;
  }

  const login = await request("POST /api/auth/login", `${baseUrl}/api/auth/login`, {
    method: "POST",
    body: { pin: ownerPin },
  });
  recordResponse(metrics, login);

  if (!login.ok || !login.cookie) {
    return "";
  }

  return login.cookie;
}

async function runOwnerScenario(metrics, workerState = null) {
  let cookie = reuseOwnerSession ? String(workerState?.ownerCookie || "") : "";
  if (!cookie) {
    cookie = await authenticateOwner(metrics);
    if (reuseOwnerSession && workerState && cookie) {
      workerState.ownerCookie = cookie;
    }
  }

  if (!cookie) {
    return;
  }

  const ownerEndpoints = [
    { label: "GET /api/auth/me", url: `${baseUrl}/api/auth/me` },
    { label: "GET /api/reports/notifications", url: `${baseUrl}/api/reports/notifications` },
    { label: "GET /api/reports/owner-assistant", url: `${baseUrl}/api/reports/owner-assistant` },
    {
      label: "POST /api/reports/owner-assistant",
      url: `${baseUrl}/api/reports/owner-assistant`,
      method: "POST",
      body: {
        question: "What needs my attention right now?",
        history: [],
      },
    },
  ];

  for (const endpoint of ownerEndpoints) {
    const response = await request(endpoint.label, endpoint.url, {
      method: endpoint.method,
      body: endpoint.body,
      cookie,
    });
    recordResponse(metrics, response);
  }
}

async function runMixedScenario(metrics, workerState = null) {
  await runPublicScenario(metrics);
  await runOwnerScenario(metrics, workerState);
}

function printEndpointSummary(metrics) {
  const labels = Object.keys(metrics.endpointStats);
  if (!labels.length) {
    return;
  }

  console.log("\n=== Endpoint Breakdown ===");
  for (const label of labels) {
    const entry = metrics.endpointStats[label];
    console.log(
      `${label}: count=${entry.count}, p50=${percentile(entry.latencies, 0.5)}, p95=${percentile(
        entry.latencies,
        0.95
      )}, statusCodes=${JSON.stringify(entry.statusCodes)}`
    );
  }
}

function enforceThresholds(metrics) {
  const p95 = percentile(metrics.latencies, 0.95);
  const p99 = percentile(metrics.latencies, 0.99);

  if (maxP95Ms !== null && p95 > maxP95Ms) {
    metrics.failures.push(`p95 latency ${p95}ms exceeded threshold ${maxP95Ms}ms`);
  }

  if (maxP99Ms !== null && p99 > maxP99Ms) {
    metrics.failures.push(`p99 latency ${p99}ms exceeded threshold ${maxP99Ms}ms`);
  }
}

async function main() {
  let backendProcess = null;
  const backendLive = (await requestStatus(`${baseUrl}/api/system/health`)) >= 200;

  if (!backendLive) {
    console.log(`Starting local backend for load verification against ${baseUrl}...`);
    backendProcess = spawnBackend();
    const ready = await waitForBackend();
    if (!ready) {
      console.error("Backend did not become healthy in time.");
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill("SIGINT");
      }
      process.exit(1);
    }
  }

  const metrics = {
    latencies: [],
    statusCodes: {},
    endpointStats: {},
    failures: [],
  };
  const scenarioRunner =
    scenario === "owner"
      ? runOwnerScenario
      : scenario === "mixed"
      ? runMixedScenario
      : runPublicScenario;

  console.log(
    `Running ${scenario} load verification with ${virtualUsers} virtual users x ${iterations} iteration(s) against ${baseUrl}...`
  );

  const workers = Array.from({ length: virtualUsers }, async () => {
    const workerState = {
      ownerCookie: "",
    };

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      await scenarioRunner(metrics, workerState);
    }
  });

  await Promise.all(workers);
  enforceThresholds(metrics);

  const totalRequests = Object.values(metrics.statusCodes).reduce((sum, value) => sum + Number(value || 0), 0);
  console.log("\n=== Load Summary ===");
  console.log(`scenario: ${scenario}`);
  console.log(`virtualUsers: ${virtualUsers}`);
  console.log(`iterations: ${iterations}`);
  console.log(`requests: ${totalRequests}`);
  console.log(`p50Ms: ${percentile(metrics.latencies, 0.5)}`);
  console.log(`p95Ms: ${percentile(metrics.latencies, 0.95)}`);
  console.log(`p99Ms: ${percentile(metrics.latencies, 0.99)}`);
  console.log(`statusCodes: ${JSON.stringify(metrics.statusCodes)}`);
  printEndpointSummary(metrics);

  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill("SIGINT");
  }

  if (metrics.failures.length) {
    console.error("\nLoad verification detected failures:");
    for (const failure of metrics.failures.slice(0, 20)) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("\nPASS: Load verification completed without request failures.");
}

main().catch((error) => {
  console.error("Load verification failed:", error?.message || error);
  process.exit(1);
});
