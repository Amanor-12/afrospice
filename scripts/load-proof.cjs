const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const backendEntryPath = path.join(backendDir, "server.js");
const smokeScriptPath = path.join(__dirname, "load-smoke.cjs");

const baseUrl = String(process.env.LOAD_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const ownerPin = String(process.env.LOAD_OWNER_PIN || "").trim();
const proofScale = readBoundedInteger(process.env.LOAD_PROOF_SCALE, 1, {
  min: 1,
  max: 5,
});
const requireOwnerScenario =
  String(process.env.LOAD_PROOF_REQUIRE_OWNER || "false").trim().toLowerCase() === "true";

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

function buildScenarioPlan(ownerSessionCookie = "") {
  const scenarios = [
    {
      label: "public-burst",
      env: {
        LOAD_SCENARIO: "public",
        LOAD_USERS: String(12 * proofScale),
        LOAD_ITERATIONS: String(8 * proofScale),
        LOAD_MAX_P95_MS: "1500",
        LOAD_MAX_P99_MS: "2500",
      },
    },
    {
      label: "public-soak",
      env: {
        LOAD_SCENARIO: "public",
        LOAD_USERS: String(4 * proofScale),
        LOAD_ITERATIONS: String(20 * proofScale),
        LOAD_MAX_P95_MS: "1800",
        LOAD_MAX_P99_MS: "2800",
      },
    },
  ];

  if (ownerPin) {
    scenarios.push({
      label: "mixed-owner-proof",
      env: {
        LOAD_SCENARIO: "mixed",
        LOAD_USERS: String(6 * proofScale),
        LOAD_ITERATIONS: String(6 * proofScale),
        LOAD_OWNER_COOKIE: ownerSessionCookie,
        LOAD_OWNER_SESSION_REUSE: "true",
        LOAD_MAX_P95_MS: "4500",
        LOAD_MAX_P99_MS: "6500",
      },
    });
  } else if (requireOwnerScenario) {
    throw new Error("LOAD_OWNER_PIN must be set when LOAD_PROOF_REQUIRE_OWNER=true.");
  }

  return scenarios;
}

async function authenticateOwnerSessionCookie() {
  if (!ownerPin) {
    return "";
  }

  const backoffWindowsMs = [0, 3000, 8000, 15000, 30000];

  for (let attempt = 0; attempt < backoffWindowsMs.length; attempt += 1) {
    if (backoffWindowsMs[attempt] > 0) {
      await wait(backoffWindowsMs[attempt]);
    }

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ pin: ownerPin }),
    });
    const payload = parseJsonSafe(await response.text());
    const cookie = normalizeSetCookie(response.headers);

    if (response.ok && cookie) {
      return cookie;
    }

    if (response.status !== 429) {
      throw new Error(
        `Owner pre-authentication failed (${response.status}): ${payload?.message || "No response body"}`
      );
    }
  }

  throw new Error(
    "Owner pre-authentication kept hitting rate limits. Let the auth window cool down and rerun the proof."
  );
}

function runScenario(scenario) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [smokeScriptPath], {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        LOAD_BASE_URL: baseUrl,
        ...scenario.env,
      },
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${scenario.label} terminated by signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${scenario.label} failed with exit code ${code}.`));
        return;
      }

      resolve();
    });
  });
}

async function shutdownBackend(backendProcess) {
  if (!backendProcess || backendProcess.killed) {
    return;
  }

  backendProcess.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => backendProcess.once("exit", resolve)),
    wait(5000),
  ]);
}

async function main() {
  let backendProcess = null;
  try {
    const backendLive = (await requestStatus(`${baseUrl}/api/system/health`)) >= 200;
    let ownerSessionCookie = "";

    if (!backendLive) {
      console.log(`Starting local backend for proof verification against ${baseUrl}...`);
      backendProcess = spawnBackend();
      const ready = await waitForBackend();
      if (!ready) {
        throw new Error("Backend did not become healthy in time.");
      }
    }

    ownerSessionCookie = await authenticateOwnerSessionCookie();
    const scenarios = buildScenarioPlan(ownerSessionCookie);

    console.log(`Running ${scenarios.length} proof scenario(s) against ${baseUrl}...`);
    for (const scenario of scenarios) {
      console.log(`\n=== Proof Scenario: ${scenario.label} ===`);
      await runScenario(scenario);
    }

    if (!ownerPin) {
      console.log(
        "\nAuthenticated proof scenario skipped because LOAD_OWNER_PIN was not set."
      );
    }

    console.log("\nPASS: Load proof completed.");
  } finally {
    await shutdownBackend(backendProcess);
  }
}

main().catch(async (error) => {
  console.error("Load proof failed:", error?.message || error);
  process.exit(1);
});
