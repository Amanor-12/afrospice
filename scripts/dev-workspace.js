const { spawn } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "frontend");

function buildSafeEnv() {
  if (process.platform !== "win32") {
    return process.env;
  }

  const env = {};
  const seen = new Set();

  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toLowerCase();
    if (normalized === "path" || seen.has(normalized)) {
      continue;
    }
    env[key] = value;
    seen.add(normalized);
  }

  env.Path = process.env.Path || process.env.PATH || "";
  return env;
}

console.log("Starting AfroSpice workspace dev environment...");
console.log(`Workspace: ${rootDir}`);
console.log(`Launcher:  ${path.join(frontendDir, "scripts", "dev-server.cjs")}`);

const child = spawn(process.execPath, [path.join(frontendDir, "scripts", "dev-server.cjs")], {
  cwd: frontendDir,
  stdio: "inherit",
  env: buildSafeEnv(),
});

child.on("error", (error) => {
  console.error("[workspace] failed to start:", error.message || error);
});

child.on("exit", (code, signal) => {
  const exitCode = typeof code === "number" ? code : `signal:${signal}`;
  console.log(`[workspace] exited (${exitCode}).`);
});
