const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const targets = [
  path.join(rootDir, "frontend", "dist"),
  path.join(rootDir, "frontend", "playwright-report"),
  path.join(rootDir, "frontend", "test-results"),
];

for (const target of targets) {
  if (!fs.existsSync(target)) {
    continue;
  }

  fs.rmSync(target, {
    recursive: true,
    force: true,
  });
  console.log(`Removed ${path.relative(rootDir, target)}`);
}

console.log("Frontend artifact cleanup completed.");
