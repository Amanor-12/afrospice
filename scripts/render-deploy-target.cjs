const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv = []) {
  const options = {
    source: "",
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (token === "--write") {
      options.write = true;
      continue;
    }
    if (token === "--source") {
      options.source = String(argv[index + 1] || "").trim();
      index += 1;
    }
  }

  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(sourcePath) {
  const absolutePath = path.resolve(rootDir, sourcePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  return {
    absolutePath,
    data: JSON.parse(raw),
  };
}

function normalizeOrigin(value, label) {
  const candidate = String(value || "").trim().replace(/\/+$/, "");
  assert(candidate, `${label} is required.`);

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }

  assert(/^https?:$/i.test(parsed.protocol), `${label} must use http or https.`);
  return parsed.origin;
}

function hostFromOrigin(origin) {
  return new URL(origin).host;
}

function buildFrontendApiUrl(frontendOrigin, apiOrigin, topology) {
  if (topology === "same-origin") {
    return "";
  }

  return `${apiOrigin}/api`;
}

function buildClientReportingEndpoint(apiOrigin, topology) {
  if (topology === "same-origin") {
    return "/api/system/client-events";
  }

  return `${apiOrigin}/api/system/client-events`;
}

function stringifyEnv(entries = {}) {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  assert(args.source, "Pass --source deploy/targets/<name>.json");

  const { data, absolutePath } = readJson(args.source);
  const environment = String(data.environment || "").trim().toLowerCase();
  assert(["staging", "production"].includes(environment), "environment must be staging or production.");

  const topology = String(data.topology || "same-origin").trim().toLowerCase();
  assert(["same-origin", "split-origin"].includes(topology), "topology must be same-origin or split-origin.");

  const frontendOrigin = normalizeOrigin(data.frontendOrigin, "frontendOrigin");
  const apiOrigin = normalizeOrigin(
    data.apiOrigin || (topology === "same-origin" ? data.frontendOrigin : ""),
    "apiOrigin"
  );

  const allowedHosts = [
    hostFromOrigin(apiOrigin),
    ...((Array.isArray(data.allowedHosts) ? data.allowedHosts : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)),
  ].filter((value, index, values) => values.indexOf(value) === index);

  const release = String(data.release || `${environment}-sha-placeholder`).trim();
  const monitoringWebhookUrl = String(data.observabilityWebhookUrl || "").trim();
  const backendSentryDsn = String(data.backendSentryDsn || "").trim();
  const frontendSentryDsn = String(data.frontendSentryDsn || "").trim();
  const mongoUri = String(data.mongoUri || "").trim();
  assert(mongoUri, "mongoUri is required.");

  const mail = data.mail && typeof data.mail === "object" ? data.mail : {};
  const backendEnv = {
    PORT: 5000,
    NODE_ENV: "production",
    MONGO_URI: mongoUri,
    FRONTEND_ORIGIN: frontendOrigin,
    PUBLIC_BASE_URL: frontendOrigin,
    ALLOWED_HOSTS: allowedHosts.join(","),
    TRUST_PROXY: 1,
    ENFORCE_HTTPS: "true",
    JWT_SECRET: "<replace-with-a-64-character-secret>",
    JWT_ISSUER: "afrospice-api",
    JWT_AUDIENCE: "afrospice-workspace",
    JWT_EXPIRES: "12h",
    AUTH_COOKIE_NAME: "__Host-afrospice_session",
    AUTH_COOKIE_SECURE: "true",
    AUTH_COOKIE_SAMESITE: "strict",
    SESSION_IDLE_TIMEOUT_MINUTES: 720,
    SESSION_ABSOLUTE_TIMEOUT_MINUTES: 10080,
    AUTH_LOGIN_RATE_LIMIT_MAX: 10,
    AUTH_CHANGE_PIN_RATE_LIMIT_MAX: 8,
    SERVER_REQUEST_TIMEOUT_MS: 30000,
    SERVER_HEADERS_TIMEOUT_MS: 35000,
    SERVER_KEEP_ALIVE_TIMEOUT_MS: 5000,
    SERVER_MAX_REQUESTS_PER_SOCKET: 1000,
    SERVER_SHUTDOWN_GRACE_PERIOD_MS: 15000,
    OBSERVABILITY_SERVICE_NAME: "afrospice-api",
    OBSERVABILITY_ENVIRONMENT: environment,
    OBSERVABILITY_RELEASE: release,
    OBSERVABILITY_WEBHOOK_URL: monitoringWebhookUrl,
    OBSERVABILITY_WEBHOOK_TIMEOUT_MS: 3000,
    CLIENT_ERROR_REPORTING_ENABLED: "true",
    CLIENT_ERROR_REPORTING_RATE_LIMIT_MAX: 120,
    CLIENT_ERROR_REPORTING_SAMPLE_RATE: 1,
    SENTRY_DSN: backendSentryDsn,
    SENTRY_ENABLED: backendSentryDsn ? "true" : "false",
    SENTRY_TRACES_SAMPLE_RATE: 0,
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "gpt-5-mini",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    EXTERNAL_ASSISTANT_ENABLED: "false",
    MAIL_PROVIDER: String(mail.provider || "resend").trim() || "resend",
    RESEND_API_KEY: "",
    RESEND_FROM_EMAIL: String(mail.fromEmail || "").trim(),
    RESEND_FROM_NAME: String(mail.fromName || "").trim(),
    RESEND_REPLY_TO: String(mail.replyTo || "").trim(),
    BOOTSTRAP_SAMPLE_DATA: "false",
  };

  const frontendEnv = {
    VITE_API_URL: buildFrontendApiUrl(frontendOrigin, apiOrigin, topology),
    VITE_BACKEND_URL: apiOrigin,
    VITE_APP_RELEASE: release,
    VITE_CLIENT_ERROR_REPORTING_ENABLED: "true",
    VITE_CLIENT_ERROR_REPORTING_ENDPOINT: buildClientReportingEndpoint(apiOrigin, topology),
    VITE_CLIENT_ERROR_REPORTING_SAMPLE_RATE: 1,
    VITE_SENTRY_DSN: frontendSentryDsn,
    VITE_SENTRY_ENABLED: frontendSentryDsn ? "true" : "false",
    VITE_SENTRY_TRACES_SAMPLE_RATE: 0,
  };

  const backendOutputPath = path.join(rootDir, "deploy", "env", `backend.${environment}.env`);
  const frontendOutputPath = path.join(rootDir, "deploy", "env", `frontend.${environment}.env`);
  const backendContent = `${stringifyEnv(backendEnv)}\n`;
  const frontendContent = `${stringifyEnv(frontendEnv)}\n`;

  console.log(`Source: ${absolutePath}`);
  console.log(`environment: ${environment}`);
  console.log(`topology: ${topology}`);
  console.log(`frontendOrigin: ${frontendOrigin}`);
  console.log(`apiOrigin: ${apiOrigin}`);
  console.log(`allowedHosts: ${allowedHosts.join(",")}`);
  console.log(`backendEnv: ${backendOutputPath}`);
  console.log(`frontendEnv: ${frontendOutputPath}`);

  if (!args.write) {
    console.log("\n--- backend env preview ---\n");
    console.log(backendContent);
    console.log("--- frontend env preview ---\n");
    console.log(frontendContent);
    console.log("Pass --write to persist the rendered env files.");
    return;
  }

  fs.writeFileSync(backendOutputPath, backendContent, "utf8");
  fs.writeFileSync(frontendOutputPath, frontendContent, "utf8");
  console.log("\nRendered deployment env files.");
}

try {
  main();
} catch (error) {
  console.error("Failed to render deploy target:", error?.message || error);
  process.exit(1);
}
