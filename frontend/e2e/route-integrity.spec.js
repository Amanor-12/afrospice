import { expect, test } from "@playwright/test";
import { signInAsOwner, trackCriticalPageErrors } from "./helpers/auth.js";

test("staff and refund actions resolve to the correct workspace routes", async ({ page }) => {
  const criticalErrors = trackCriticalPageErrors(page);

  await signInAsOwner(page);

  await page.goto("/users");
  await expect(page.locator(".users-management-command-actions")).toBeVisible();
  await page.locator(".reference-page-heading-actions").getByRole("button", { name: /^create staff record$/i }).click();
  await expect(page).toHaveURL(/\/users\/staff\/new$/);
  await expect(page.locator(".users-management-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: /create staff record/i })).toBeVisible();

  await page.goto("/users");
  await page.getByRole("button", { name: /^view$/i }).first().click();
  await expect(page).toHaveURL(/\/users\/staff\/.+/);
  await expect(page.locator(".users-management-page")).toBeVisible();
  await expect(page.locator(".users-management-tab.is-active")).toContainText(/^security$/i);
  await expect(page.getByText(/pin, approval, and account control/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /inventory/i })).toHaveCount(0);

  await page.goto("/orders");
  await expect(page.locator(".orders-reference-toolbar")).toBeVisible();
  const refundButton = page.locator(".orders-table-actions button:not([disabled])").first();
  await expect(refundButton).toBeVisible();
  await refundButton.click();
  await expect(page).toHaveURL(/\/orders\/refunds$/);
  await expect(page.locator(".refund-desk-page")).toBeVisible();

  expect(criticalErrors).toEqual([]);
});
