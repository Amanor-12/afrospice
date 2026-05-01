import { expect, test } from "@playwright/test";
import { signInAsOwner, trackCriticalPageErrors } from "./helpers/auth.js";

const OWNER_ROUTE_EXPECTATIONS = [
  { path: "/", chip: /dashboard/i },
  { path: "/pos-dashboard", chip: /inventory/i },
  { path: "/terminal", chip: /pos terminal/i },
  { path: "/orders", chip: /orders/i },
  { path: "/orders/refunds", chip: /orders/i },
  { path: "/reports", chip: /reports/i },
  { path: "/customers", chip: /customers/i },
  { path: "/suppliers", chip: /suppliers/i },
  { path: "/purchase-orders/new", chip: /procurement/i },
  { path: "/users", chip: /user management/i },
  { path: "/settings", chip: /settings/i },
];

test("owner can navigate production-critical routes without shell regressions", async ({ page }) => {
  const criticalErrors = trackCriticalPageErrors(page);

  await signInAsOwner(page);
  await expect(page.locator(".workspace-command-chip")).toHaveText(/dashboard/i);

  for (const route of OWNER_ROUTE_EXPECTATIONS) {
    await page.goto(route.path);
    await expect(page).toHaveURL(new RegExp(`${route.path === "/" ? "/$" : route.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.locator(".workspace-command-chip")).toContainText(route.chip);
    await expect(page.locator(".page-shell")).toBeVisible();
    await expect(page.locator(".app-boot-shell")).toHaveCount(0);
  }

  expect(criticalErrors).toEqual([]);
});
