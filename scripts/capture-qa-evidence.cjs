const fs = require("fs");
const path = require("path");
const { chromium } = require("../frontend/node_modules/playwright");

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173";
const ownerPin = process.env.E2E_OWNER_PIN || "7700";
const browserChannel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined);
const evidenceDir = path.join(__dirname, "..", "qa", "evidence", "screenshots");

fs.mkdirSync(evidenceDir, { recursive: true });

async function signInAsOwner(page) {
  await page.goto(`${baseURL}/login`, { waitUntil: "networkidle" });

  const pinInput = page.locator("#pin");
  const fallbackToggle = page.getByRole("button", { name: /sign-in options|use owner pin instead/i });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await pinInput.isVisible()) {
      break;
    }
    if (await fallbackToggle.isVisible()) {
      await fallbackToggle.click();
      break;
    }
    await page.waitForTimeout(250);
  }

  await pinInput.fill(ownerPin);
  await page.getByRole("button", { name: /unlock with pin/i }).click();
  await page.waitForURL(/\/$/, { timeout: 20000 });
}

async function ensureDarkMode(page) {
  await page.goto(`${baseURL}/settings`, { waitUntil: "networkidle" });
  const darkModeToggle = page
    .locator(".settings-toggle-row")
    .filter({ hasText: "Use dark mode" })
    .locator('input[type="checkbox"]');

  if (!(await darkModeToggle.isChecked())) {
    await darkModeToggle.check({ force: true });
  }

  await page.waitForFunction(() => document.body.classList.contains("dark"));
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(browserChannel ? { channel: browserChannel } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const page = await context.newPage();

  try {
    await signInAsOwner(page);

    await page.screenshot({ path: path.join(evidenceDir, "auth-dashboard.png"), fullPage: true });

    const assistantTrigger = page.getByRole("button", { name: /open business assistant/i });
    await assistantTrigger.click();
    await page.locator(".owner-assistant-card").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(evidenceDir, "assistant-open.png"), fullPage: true });

    const composer = page.getByPlaceholder(
      /ask about revenue, inventory, orders, suppliers, staffing, or forecasting/i
    );
    await composer.fill("What needs my attention right now?");
    await page.locator(".owner-assistant-send").click();
    await page.locator(".owner-assistant-message-assistant").last().waitFor({ state: "visible" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(evidenceDir, "assistant-response.png"), fullPage: true });

    await page.goto(`${baseURL}/users/staff/new`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(evidenceDir, "users-create-staff.png"), fullPage: true });

    await page.goto(`${baseURL}/users`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^view$/i }).first().click();
    await page.waitForURL(/\/users\/staff\/.+/, { timeout: 20000 });
    await page.screenshot({ path: path.join(evidenceDir, "users-staff-security.png"), fullPage: true });

    await page.goto(`${baseURL}/orders/refunds`, { waitUntil: "networkidle" });
    await page.getByLabel("Paid order").selectOption({ index: 1 });
    await page.getByLabel("Refund reason").fill("Duplicate checkout");
    await page.getByLabel("Incident report").fill("Customer was charged twice at the lane and staff verified the duplicate receipt.");
    await page.screenshot({ path: path.join(evidenceDir, "refund-desk-ready.png"), fullPage: true });

    await ensureDarkMode(page);
    await page.screenshot({ path: path.join(evidenceDir, "settings-dark-mode.png"), fullPage: true });

    await page.goto(`${baseURL}/customers/3`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(evidenceDir, "customer-profile-dark.png"), fullPage: true });
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
