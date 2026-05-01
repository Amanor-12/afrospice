const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const rootDir = path.resolve(__dirname, "..");
const assetsDir = path.join(rootDir, "frontend", "dist", "assets");

const budgetDefinitions = [
  {
    label: "app shell javascript",
    pattern: /^index-.*\.js$/,
    maxGzipKb: Number(process.env.BUDGET_APP_SHELL_GZIP_KB || 18),
    required: true,
  },
  {
    label: "react vendor javascript",
    pattern: /^react-vendor-.*\.js$/,
    maxGzipKb: Number(process.env.BUDGET_REACT_VENDOR_GZIP_KB || 65),
    required: true,
  },
  {
    label: "charts javascript",
    pattern: /^charts-.*\.js$/,
    maxGzipKb: Number(process.env.BUDGET_CHARTS_GZIP_KB || 120),
    required: true,
  },
  {
    label: "routing javascript",
    pattern: /^routing-.*\.js$/,
    maxGzipKb: Number(process.env.BUDGET_ROUTING_GZIP_KB || 18),
    required: true,
  },
  {
    label: "monitoring javascript",
    pattern: /^monitoring-.*\.js$/,
    maxGzipKb: Number(process.env.BUDGET_MONITORING_GZIP_KB || 30),
    required: false,
  },
  {
    label: "icons javascript",
    pattern: /^icons-.*\.js$/,
    maxGzipKb: Number(process.env.BUDGET_ICONS_GZIP_KB || 12),
    required: false,
  },
  {
    label: "global stylesheet",
    pattern: /^index-.*\.css$/,
    maxGzipKb: Number(process.env.BUDGET_CSS_GZIP_KB || 45),
    required: true,
  },
];

function toKb(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

function readAssetStats(filename) {
  const absolutePath = path.join(assetsDir, filename);
  const content = fs.readFileSync(absolutePath);
  return {
    filename,
    rawKb: toKb(content.length),
    gzipKb: toKb(zlib.gzipSync(content).length),
  };
}

function main() {
  if (!fs.existsSync(assetsDir)) {
    throw new Error("frontend/dist/assets does not exist. Run the frontend build first.");
  }

  const filenames = fs.readdirSync(assetsDir);
  const failures = [];

  console.log("=== Frontend Performance Budgets ===");

  for (const budget of budgetDefinitions) {
    const matchedFile = filenames.find((filename) => budget.pattern.test(filename));

    if (!matchedFile) {
      const missingMessage = `${budget.label}: missing asset`;
      console.log(`[${budget.required ? "FAIL" : "SKIP"}] ${missingMessage}`);
      if (budget.required) {
        failures.push(missingMessage);
      }
      continue;
    }

    const stats = readAssetStats(matchedFile);
    const withinBudget = stats.gzipKb <= budget.maxGzipKb;
    console.log(
      `[${withinBudget ? "PASS" : "FAIL"}] ${budget.label}: ${stats.filename} raw=${stats.rawKb}KB gzip=${stats.gzipKb}KB budget=${budget.maxGzipKb}KB`
    );

    if (!withinBudget) {
      failures.push(
        `${budget.label} exceeded gzip budget (${stats.gzipKb}KB > ${budget.maxGzipKb}KB)`
      );
    }
  }

  if (failures.length) {
    console.error("\nFrontend budget verification failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("\nPASS: Frontend asset budgets are within thresholds.");
}

main();
