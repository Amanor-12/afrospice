const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const SOURCE_DIR = path.resolve(__dirname, "../src/assets/products");
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const MAX_WIDTH = 960;
const WEBP_QUALITY = 82;
const WEBP_EFFORT = 6;

function toMegabytes(bytes) {
  return Number((Number(bytes || 0) / (1024 * 1024)).toFixed(2));
}

async function optimizeImage(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return null;
  }

  const inputPath = path.join(SOURCE_DIR, filename);
  const outputPath = path.join(SOURCE_DIR, `${path.basename(filename, extension)}.webp`);
  const inputStats = await fs.stat(inputPath);

  let pipeline = sharp(inputPath, { failOn: "none" }).rotate();
  const metadata = await pipeline.metadata();
  if (Number(metadata?.width || 0) > MAX_WIDTH) {
    pipeline = pipeline.resize({
      width: MAX_WIDTH,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  await pipeline.webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT }).toFile(outputPath);
  const outputStats = await fs.stat(outputPath);

  return {
    filename,
    outputFilename: path.basename(outputPath),
    beforeBytes: inputStats.size,
    afterBytes: outputStats.size,
  };
}

async function run() {
  const entries = await fs.readdir(SOURCE_DIR, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const results = [];

  for (const file of files) {
    const result = await optimizeImage(file);
    if (result) {
      results.push(result);
    }
  }

  const totals = results.reduce(
    (accumulator, item) => {
      accumulator.beforeBytes += item.beforeBytes;
      accumulator.afterBytes += item.afterBytes;
      return accumulator;
    },
    { beforeBytes: 0, afterBytes: 0 }
  );

  const savingsBytes = Math.max(0, totals.beforeBytes - totals.afterBytes);
  const savingsPct =
    totals.beforeBytes > 0
      ? Number(((savingsBytes / totals.beforeBytes) * 100).toFixed(1))
      : 0;

  console.log(
    [
      "Product image optimization complete.",
      `optimized: ${results.length}`,
      `sourceSizeMB: ${toMegabytes(totals.beforeBytes)}`,
      `optimizedSizeMB: ${toMegabytes(totals.afterBytes)}`,
      `savedMB: ${toMegabytes(savingsBytes)}`,
      `savedPct: ${savingsPct}%`,
    ].join(" ")
  );
}

run().catch((error) => {
  console.error("Product image optimization failed:", error?.message || error);
  process.exitCode = 1;
});
