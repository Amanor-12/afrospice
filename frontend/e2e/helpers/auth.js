import { expect } from "@playwright/test";

export const OWNER_PIN = globalThis.process?.env?.E2E_OWNER_PIN || "7700";

export async function openPinFallback(page) {
  const pinInput = page.locator("#pin");
  const fallbackToggle = page.getByRole("button", { name: /sign-in options|use owner pin instead/i });
  await expect
    .poll(async () => (await pinInput.isVisible()) || (await fallbackToggle.isVisible()), {
      timeout: 20000,
    })
    .toBe(true);

  if (!(await pinInput.isVisible()) && (await fallbackToggle.isVisible())) {
    await fallbackToggle.click();
  }

  await expect(pinInput).toBeVisible();
  return pinInput;
}

export async function signInAsOwner(page) {
  await page.goto("/login");
  await expect
    .poll(async () => {
      const hasSignInHeading = await page
        .getByRole("heading", { name: /sign in to your workspace|unlock your workspace/i })
        .isVisible();
      const hasWelcomeCopy = await page.getByText(/welcome back/i).first().isVisible();
      return hasSignInHeading || hasWelcomeCopy;
    }, { timeout: 15000 })
    .toBe(true);

  const pinInput = await openPinFallback(page);
  await pinInput.fill(OWNER_PIN);
  await page.getByRole("button", { name: /unlock with pin/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

export function trackCriticalPageErrors(page) {
  const criticalErrors = [];

  page.on("pageerror", (error) => {
    criticalErrors.push(`pageerror:${error?.message || error}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }

    const text = String(message.text() || "").trim();
    if (
      !text ||
      text.includes("Failed to load resource") ||
      text.includes("favicon") ||
      text.includes("401") ||
      text.includes("Unauthorized")
    ) {
      return;
    }

    criticalErrors.push(`console:${text}`);
  });

  return criticalErrors;
}
