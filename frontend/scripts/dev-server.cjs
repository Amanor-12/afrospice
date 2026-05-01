const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const frontendDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(frontendDir, "..");
const backendDir = path.join(rootDir, "backend");
const backendEntryPath = path.join(backendDir, "server.js");
const BACKEND_HEALTH_URL = "http://localhost:5000/api/system/health";
const FRONTEND_APP_URL = "http://localhost:5173";
const BACKEND_CAPABILITY_URLS = [
  "http://localhost:5000/api/auth/passkeys",
  "http://localhost:5000/api/settings/email-logs",
  "http://localhost:5000/api/reports/owner-assistant",
  "http://localhost:5000/api/reports/notifications",
  "http://localhost:5000/api/customers/preview/new",
  "http://localhost:5000/api/customers/1/communications",
];
const viteBinPath = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");

function buildSafeEnv() {
  if (process.platform !== "win32") {
    return process.env;
  }

  const env = {};
  const seen = new Set();

  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toLowerCase();
    if (normalized === "path") {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    env[key] = value;
    seen.add(normalized);
  }

  env.Path = process.env.Path || process.env.PATH || "";
  return env;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

async function checkBackendHealth(timeoutMs = 1500) {
  const statusCode = await requestStatus(BACKEND_HEALTH_URL, timeoutMs);
  return statusCode >= 200 && statusCode < 500;
}

async function checkFrontendHealth(timeoutMs = 1500) {
  const statusCode = await requestStatus(FRONTEND_APP_URL, timeoutMs);
  return statusCode >= 200 && statusCode < 500;
}

function isCapabilityStatusHealthy(statusCode) {
  return statusCode >= 200 && statusCode < 500 && statusCode !== 404;
}

async function checkBackendCapabilities(timeoutMs = 1500) {
  const statuses = await Promise.all(
    BACKEND_CAPABILITY_URLS.map((url) => requestStatus(url, timeoutMs))
  );

  return statuses.every(isCapabilityStatusHealthy);
}

async function waitForBackend(maxAttempts = 60, requireCapabilities = false) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const backendHealthy = await checkBackendHealth();
    if (!backendHealthy) {
      await wait(500);
      continue;
    }

    if (!requireCapabilities || (await checkBackendCapabilities())) {
      return true;
    }

    await wait(500);
  }

  return false;
}

function terminateBackendProcessOnPort(port) {
  if (process.platform !== "win32") {
    return false;
  }

  const script = [
    "$connection = Get-NetTCPConnection -LocalPort " + Number(port) + " -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $connection) { Write-Output 'NO_PROCESS'; exit 0 }",
    "$pid = [int]$connection.OwningProcess",
    "$process = Get-CimInstance Win32_Process -Filter \"ProcessId = $pid\"",
    "$name = [string]($process.Name)",
    "$commandLine = [string]($process.CommandLine)",
    "if ($name -match 'node' -or $commandLine -match 'afrospice') { Stop-Process -Id $pid -Force; Write-Output ('TERMINATED:' + $pid); exit 0 }",
    "Write-Output ('REFUSED:' + $pid + ':' + $name)",
    "exit 2",
  ].join("; ");

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: rootDir,
    env: buildSafeEnv(),
    encoding: "utf8",
  });

  const output = String(result.stdout || result.stderr || "").trim();
  if (output) {
    console.log(`[workspace] ${output}`);
  }

  return result.status === 0;
}

function spawnProcess(command, args, cwd, env, label) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env,
  });

  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error.message || error);
  });

  return child;
}

function spawnBackendProcess(env) {
  // Keep the default workspace runtime stable. File watching is useful during
  // active backend development, but it is a poor default for the owner-facing
  // local stack because incidental file churn can flap the API.
  return spawnProcess(process.execPath, [backendEntryPath], backendDir, env, "backend");
}

async function main() {
  const env = buildSafeEnv();
  let backendProcess = null;
  let frontendProcess = null;
  let startedBackend = false;
  let shuttingDown = false;

  const backendIsLive = await checkBackendHealth();
  const backendSupportsCapabilities = backendIsLive
    ? await checkBackendCapabilities()
    : false;

  if (!backendIsLive) {
    console.log("Backend not detected on localhost:5000. Starting local backend...");
    backendProcess = spawnBackendProcess(env);
    startedBackend = true;

    const backendReady = await waitForBackend(60, true);
    if (!backendReady) {
      console.error("Backend did not become healthy on http://localhost:5000.");
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill("SIGINT");
      }
      process.exit(1);
    }
  } else if (!backendSupportsCapabilities) {
    console.log("Backend is running but missing required routes. Restarting the local AfroSpice backend...");
    const terminated = terminateBackendProcessOnPort(5000);
    if (!terminated) {
      console.error("Could not replace the stale backend process on port 5000.");
      process.exit(1);
    }

    backendProcess = spawnBackendProcess(env);
    startedBackend = true;

    const backendReady = await waitForBackend(60, true);
    if (!backendReady) {
      console.error("Restarted backend did not become ready with the required routes.");
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill("SIGINT");
      }
      process.exit(1);
    }
  } else {
    console.log("Backend already running on localhost:5000 with the required routes.");
  }

  const frontendIsLive = await checkFrontendHealth();
  if (frontendIsLive) {
    console.log("Frontend already running on http://localhost:5173.");
    console.log("Workspace runtime is ready.");
    return;
  }

  console.log("Starting frontend on http://localhost:5173...");
  frontendProcess = spawnProcess(
    process.execPath,
    [viteBinPath, "--configLoader", "native"],
    frontendDir,
    env,
    "frontend"
  );

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (frontendProcess && !frontendProcess.killed) {
      frontendProcess.kill("SIGINT");
    }

    if (startedBackend && backendProcess && !backendProcess.killed) {
      backendProcess.kill("SIGINT");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  frontendProcess.on("exit", (code) => {
    if (!shuttingDown) {
      shutdown();
      process.exit(typeof code === "number" ? code : 0);
    }
  });

  if (backendProcess) {
    backendProcess.on("exit", (code) => {
      if (!shuttingDown) {
        console.error(`[backend] exited early (${typeof code === "number" ? code : "unknown"}).`);
        shutdown();
        process.exit(typeof code === "number" ? code : 1);
      }
    });
  }
}

main().catch((error) => {
  console.error("Workspace dev launcher failed:", error);
  process.exit(1);
});
