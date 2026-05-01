import { expect, test } from "@playwright/test";
import { signInAsOwner, trackCriticalPageErrors } from "./helpers/auth.js";

test.setTimeout(120000);

test("production-critical surfaces expose the refined controls and layouts", async ({ page }) => {
  const criticalErrors = trackCriticalPageErrors(page);

  await signInAsOwner(page);

  await page.goto("/orders");
  await expect(page.locator(".orders-reference-toolbar")).toBeVisible();
  await expect(page.locator(".orders-reference-toolbar .range-switch")).toHaveCount(0);
  await expect(page.locator('.orders-reference-table-card input[type="checkbox"]')).toHaveCount(0);
  await page.locator(".orders-table-actions button:not([disabled])").first().click();
  await expect(page).toHaveURL(/\/orders\/refunds$/);
  await expect(page.locator(".refund-desk-status-bar").first()).toBeVisible();

  await page.goto("/terminal");
  await expect(page.locator(".pos-reference-ticket-status")).toBeVisible();
  await page.locator(".pos-catalog-card").first().click();
  await expect(page.locator(".pos-ref-order-row").first()).toBeVisible();
  await expect(page.locator(".pos-reference-ticket-status .status-pill")).toContainText("Active ticket");
  await page.locator(".pos-reference-ticket-status button").click();
  await expect(page.locator(".pos-reference-empty")).toBeVisible();
  await expect(page.locator(".pos-reference-ticket-status .status-pill")).toContainText("Clean slate");

  await page.goto("/pos-dashboard/catalog-studio");
  await expect(page.locator(".inventory-catalog-checklist")).toBeVisible();
  const catalogNameInput = page.locator('input[name="name"]');
  const catalogSaveButton = page.getByRole("button", { name: /publish inventory record|save catalog changes/i });
  const catalogResetButton = page.getByRole("button", { name: /clear draft|restore draft|reset changes/i });
  await catalogNameInput.fill("QA Egusi Mix");
  await page.locator('input[name="sku"]').fill("QA-EGUSI-MIX");
  await page.locator('input[name="category"]').fill("Groceries");
  await page.locator('input[name="price"]').fill("12.99");
  await expect(catalogSaveButton).toBeEnabled();
  await page.locator(".inventory-catalog-checklist-item .status-pill").first().waitFor({ state: "visible" });
  await expect(page.locator(".inventory-catalog-checklist-item .status-pill").first()).toContainText(/ready|pending/i);
  await catalogResetButton.click();
  await expect(catalogNameInput).toHaveValue("");
  await expect(catalogSaveButton).toBeDisabled();

  await page.goto("/pos-dashboard/reorder");
  await expect(page.locator(".inventory-reorder-panel")).toBeVisible();
  const reorderItems = page.locator(".inventory-reorder-item");
  if ((await reorderItems.count()) > 0) {
    const selectAllButton = page.getByRole("button", { name: /select all|clear draft/i });
    const createOrdersButton = page.getByRole("button", { name: /create orders/i });
    await selectAllButton.click();
    await expect(createOrdersButton).toBeEnabled();
    await expect(selectAllButton).toContainText(/clear draft/i);
    await selectAllButton.click();
    await expect(createOrdersButton).toBeDisabled();
  }

  await page.goto("/customers");
  await expect(page.locator(".customers-focus-strip")).toBeVisible();
  await page.getByRole("button", { name: /^view$/i }).first().click();
  await expect(page.locator(".customer-record-readiness-strip")).toBeVisible();
  await expect(page.locator(".customer-record-operator-bar")).toBeVisible();
  const customerNameInput = page.locator(".customer-record-field .input").first();
  const originalCustomerName = await customerNameInput.inputValue();
  await customerNameInput.fill(`${originalCustomerName} QA`);
  await expect(page.locator(".customer-record-operator-bar .status-pill")).toContainText("Unsaved");
  await page.locator(".customer-record-operator-bar").getByRole("button", { name: /reset changes/i }).click();
  await expect(customerNameInput).toHaveValue(originalCustomerName);
  await expect(page.locator(".customer-record-operator-bar .status-pill")).toContainText("Saved");

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

  await page.goto("/settings");
  await expect(page.locator(".settings-control-owner-card")).toBeVisible();
  await expect(page.locator(".settings-control-owner-copy")).toContainText("Store Owner");
  await expect(page.locator(".settings-control-copy").first()).toBeVisible();
  await expect(page.locator(".settings-overview-strip")).toHaveCount(0);
  await expect(page.locator(".settings-section-status")).toHaveCount(0);
  await expect(page.locator(".settings-reference-tabs")).toHaveCount(0);
  const storeNameInput = page.locator(".settings-section-stack .input").first();
  const originalStoreName = await storeNameInput.inputValue();
  await storeNameInput.fill(`${originalStoreName} QA`);
  await expect(page.locator(".settings-control-badge").first()).toContainText("Pending changes");
  await storeNameInput.fill(originalStoreName);
  await expect(storeNameInput).toHaveValue(originalStoreName);
  await expect(page.locator(".settings-control-badge")).toHaveCount(0);
  const darkModeToggle = page
    .locator(".settings-toggle-row")
    .filter({ hasText: "Use dark mode" })
    .locator('input[type="checkbox"]');
  if (!(await darkModeToggle.isChecked())) {
    await darkModeToggle.check({ force: true });
  }
  await expect.poll(async () => page.evaluate(() => document.body.classList.contains("dark"))).toBe(true);
  await expect
    .poll(async () =>
      page.locator(".sidebar").evaluate((element) => getComputedStyle(element).backgroundImage)
    )
    .not.toContain("255, 255, 255");
  await page.locator(".settings-control-item").filter({ hasText: "Notifications" }).click();
  await expect(page.locator(".settings-notification-group").filter({ hasText: "Notification sound" }).first()).toBeVisible();

  await page.goto("/suppliers");
  await page.getByRole("button", { name: /^studio$/i }).first().click();
  await expect(page.locator(".supplier-studio-status-bar")).toBeVisible();
  await expect(page.getByLabel("Supplier name")).not.toHaveValue("");
  await expect(page.locator(".supplier-studio-status-bar .status-pill")).toContainText("Saved");
  const supplierNotesInput = page.getByLabel("Owner notes");
  const originalSupplierNotes = await supplierNotesInput.inputValue();
  await supplierNotesInput.fill(`${originalSupplierNotes} QA lane`);
  await expect(page.locator(".supplier-studio-status-bar .status-pill")).toContainText(/Ready|Unsaved/i);
  await page.locator(".supplier-studio-status-bar").getByRole("button", { name: /reset changes/i }).click();
  await expect(supplierNotesInput).toHaveValue(originalSupplierNotes);
  await expect(page.locator(".supplier-studio-status-bar .status-pill")).toContainText("Saved");

  await page.goto("/suppliers");
  await page.getByRole("button", { name: /draft supplier order/i }).click();
  await expect(page.locator(".procurement-builder-status-bar")).toBeVisible();
  const procurementProductSelect = page.getByLabel("Product").first();
  await procurementProductSelect.selectOption({ index: 1 });
  await expect(page.locator(".procurement-builder-status-bar .status-pill")).toContainText("Ready");
  await page.locator(".procurement-builder-status-bar").getByRole("button", { name: /reset draft|restore package/i }).click();
  await expect(procurementProductSelect).toHaveValue("");
  await expect(page.locator(".procurement-builder-status-bar .status-pill")).toContainText("Lines needed");

  await page.goto("/orders/refunds");
  await expect(page.locator(".refund-desk-status-bar").first()).toBeVisible();
  await page.getByLabel("Paid order").selectOption({ index: 1 });
  await page.getByLabel("Refund reason").fill("Duplicate checkout");
  await page.getByLabel("Incident report").fill("Customer was charged twice at the lane and staff verified the duplicate receipt.");
  await expect(page.locator(".refund-desk-status-bar").first().locator(".status-pill")).toContainText("Ready");
  await page.locator(".refund-desk-status-bar").first().getByRole("button", { name: /reset draft/i }).click();
  await expect(page.getByLabel("Refund reason")).toHaveValue("");
  await expect(page.locator(".refund-desk-status-bar").first().locator(".status-pill")).toContainText("Idle");
  await expect(page.getByText(/owner approval stays locked until the current owner pin is entered here/i)).toBeVisible();

  expect(criticalErrors).toEqual([]);
});
