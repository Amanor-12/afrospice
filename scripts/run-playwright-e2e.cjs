const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "frontend");
const backendDir = path.join(rootDir, "backend");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const preferredFrontendPort = Number(process.env.PLAYWRIGHT_FRONTEND_PORT || 4173);
const backendHealthUrl = "http://localhost:5000/api/system/health";
const backendCapabilityUrls = [
  "http://localhost:5000/api/auth/passkeys",
  "http://localhost:5000/api/settings/email-logs",
  "http://localhost:5000/api/reports/owner-assistant",
  "http://localhost:5000/api/reports/notifications",
  "http://localhost:5000/api/customers/preview/new",
  "http://localhost:5000/api/customers/1/communications",
];

function buildFrontendHealthUrl(port) {
  return `http://127.0.0.1:${Number(port)}`;
}

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

async function isStackHealthy() {
  const backendStatus = await requestStatus(backendHealthUrl);
  return backendStatus >= 200 && backendStatus < 500;
}

function isCapabilityStatusHealthy(statusCode) {
  return statusCode >= 200 && statusCode < 500 && statusCode !== 404;
}

async function checkBackendCapabilities(timeoutMs = 1500) {
  const statuses = await Promise.all(
    backendCapabilityUrls.map((url) => requestStatus(url, timeoutMs))
  );

  return statuses.every(isCapabilityStatusHealthy);
}

async function waitForBackend(maxAttempts = 120, requireCapabilities = false) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const backendHealthy = await isStackHealthy();
    if (!backendHealthy) {
      await wait(1000);
      continue;
    }

    if (!requireCapabilities || (await checkBackendCapabilities())) {
      return true;
    }

    await wait(1000);
  }

  return false;
}

function terminateProcessOnPort(port) {
  if (process.platform !== "win32") {
    return false;
  }

  const script = [
    "$connection = Get-NetTCPConnection -LocalPort " + Number(port) + " -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $connection) { Write-Output 'NO_PROCESS'; exit 0 }",
    "$targetPid = [int]$connection.OwningProcess",
    "$process = Get-CimInstance Win32_Process -Filter \"ProcessId = $targetPid\"",
    "$name = [string]($process.Name)",
    "$commandLine = [string]($process.CommandLine)",
    "if ($name -match 'node' -or $commandLine -match 'vite' -or $commandLine -match 'afrospice') { Stop-Process -Id $targetPid -Force; Write-Output ('TERMINATED:' + $targetPid); exit 0 }",
    "Write-Output ('REFUSED:' + $targetPid + ':' + $name)",
    "exit 2",
  ].join("; ");

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: rootDir,
    env: buildSafeEnv(),
    encoding: "utf8",
  });

  const output = String(result.stdout || result.stderr || "").trim();
  if (output) {
    console.log(`[runner] ${output}`);
  }

  return result.status === 0;
}

async function ensureFrontendPortAvailable(port) {
  const frontendHealthUrl = buildFrontendHealthUrl(port);
  const status = await requestStatus(frontendHealthUrl);
  if (status === 0) {
    return true;
  }

  console.log(`A process is already serving ${frontendHealthUrl}. Replacing it for isolated E2E...`);
  const terminated = terminateProcessOnPort(port);
  if (!terminated) {
    return false;
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const currentStatus = await requestStatus(frontendHealthUrl);
    if (currentStatus === 0) {
      return true;
    }
    await wait(250);
  }

  return false;
}

async function resolveFrontendPort() {
  const preferredAvailable = await ensureFrontendPortAvailable(preferredFrontendPort);
  if (preferredAvailable) {
    return preferredFrontendPort;
  }

  for (let offset = 1; offset <= 20; offset += 1) {
    const candidatePort = preferredFrontendPort + offset;
    const status = await requestStatus(buildFrontendHealthUrl(candidatePort));
    if (status === 0) {
      console.log(`Using alternate isolated frontend port ${candidatePort}.`);
      return candidatePort;
    }
  }

  return 0;
}

async function waitForFrontend(port, maxAttempts = 120) {
  const frontendHealthUrl = buildFrontendHealthUrl(port);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const frontendStatus = await requestStatus(frontendHealthUrl);
    if (frontendStatus >= 200 && frontendStatus < 500) {
      return true;
    }
    await wait(1000);
  }

  return false;
}

function spawnProcess(command, args, cwd, label) {
  const invocation =
    process.platform === "win32"
      ? {
          command: "cmd.exe",
          args: ["/d", "/s", "/c", command, ...args],
        }
      : {
          command,
          args,
        };

  const child = spawn(invocation.command, invocation.args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error?.message || error);
  });

  return child;
}

function spawnDirectProcess(command, args, cwd, label) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error?.message || error);
  });

  return child;
}

async function main() {
  let backendProcess = null;
  let frontendProcess = null;
  let frontendPort = preferredFrontendPort;
  const backendReady = await isStackHealthy();
  const backendSupportsCapabilities = backendReady ? await checkBackendCapabilities() : false;

  if (!backendReady) {
    console.log("Starting local backend for browser E2E...");
    backendProcess = spawnDirectProcess(
      process.execPath,
      [path.join(backendDir, "server.js")],
      backendDir,
      "backend"
    );
    const backendHealthy = await waitForBackend(120, true);
    if (!backendHealthy) {
      console.error("Backend did not become healthy with the required AfroSpice routes in time.");
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill("SIGINT");
      }
      process.exit(1);
    }
  } else if (!backendSupportsCapabilities) {
    console.log("Backend is running but missing required AfroSpice routes. Replacing it for browser E2E...");
    const terminated = terminateProcessOnPort(5000);
    if (!terminated) {
      console.error("Could not replace the stale backend process on port 5000.");
      process.exit(1);
    }

    backendProcess = spawnDirectProcess(
      process.execPath,
      [path.join(backendDir, "server.js")],
      backendDir,
      "backend"
    );
    const backendHealthy = await waitForBackend(120, true);
    if (!backendHealthy) {
      console.error("Restarted backend did not become ready with the required AfroSpice routes.");
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill("SIGINT");
      }
      process.exit(1);
    }
  } else {
    console.log("Using already-running backend on localhost:5000 with the required AfroSpice routes.");
  }

  frontendPort = await resolveFrontendPort();
  if (!frontendPort) {
    console.error(
      `Could not find an available isolated frontend port starting from ${preferredFrontendPort}.`
    );
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill("SIGINT");
    }
    process.exit(1);
  }

  console.log(`Starting isolated frontend for browser E2E on port ${frontendPort}...`);
  frontendProcess = spawnProcess(
    npmCommand,
    [
      "--prefix",
      "frontend",
      "run",
      "dev:client",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(frontendPort),
    ],
    rootDir,
    "frontend"
  );

  const frontendReady = await waitForFrontend(frontendPort);
  if (!frontendReady) {
    console.error("Frontend did not become healthy in time.");
    if (frontendProcess && !frontendProcess.killed) {
      frontendProcess.kill("SIGINT");
    }
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill("SIGINT");
    }
    process.exit(1);
  }

  const args = ["--prefix", "frontend", "run", "e2e"];
  if (process.argv.length > 2) {
    args.push("--", ...process.argv.slice(2));
  }

  const testProcess = spawn(
    process.platform === "win32" ? "cmd.exe" : npmCommand,
    process.platform === "win32"
      ? ["/d", "/s", "/c", npmCommand, ...args]
      : args,
    {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: `http://localhost:${frontendPort}`,
      },
    }
  );
  const exitCode = await new Promise((resolve) => {
    testProcess.on("exit", (code) => resolve(typeof code === "number" ? code : 1));
  });

  if (frontendProcess && !frontendProcess.killed) {
    frontendProcess.kill("SIGINT");
  }

  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill("SIGINT");
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("Browser E2E runner failed:", error?.message || error);
  process.exit(1);
});
