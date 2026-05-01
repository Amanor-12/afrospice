import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth.js";

test("owner can sign in and use the grounded assistant", async ({ page }) => {
  await signInAsOwner(page);
  const assistantTrigger = page.getByRole("button", { name: /open business assistant/i });
  await expect(assistantTrigger).toBeVisible();

  await assistantTrigger.click();
  await expect(page.getByRole("heading", { name: /executive assistant/i })).toBeVisible();
  await expect(page.getByText(/grounded workspace ai/i)).toBeVisible();

  const composer = page.getByPlaceholder(
    /ask about revenue, inventory, orders, suppliers, staffing, or forecasting/i
  );
  await expect(composer).toBeVisible();
  const assistantBodies = page.locator(".owner-assistant-message-assistant .owner-assistant-message-body");
  const baselineAssistantCount = await assistantBodies.count();
  await composer.fill("What needs my attention right now?");
  const sendButton = page.locator(".owner-assistant-send");
  await expect(sendButton).toBeEnabled({ timeout: 20000 });
  const replyResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/reports/owner-assistant") &&
      response.request().method() === "POST" &&
      response.status() === 200
  );
  await sendButton.click();
  const replyResponse = await replyResponsePromise;
  const replyPayload = await replyResponse.json();
  expect(Boolean(replyPayload?.success)).toBe(true);
  const returnedFollowUps = Array.isArray(replyPayload?.data?.followUps)
    ? replyPayload.data.followUps
    : Array.isArray(replyPayload?.data?.suggestedQuestions)
    ? replyPayload.data.suggestedQuestions
    : [];

  await expect
    .poll(async () => assistantBodies.count(), {
      timeout: 20000,
    })
    .toBeGreaterThan(baselineAssistantCount);
  const latestAssistantMessage = page.locator(".owner-assistant-message-assistant").last();
  await expect(assistantBodies.last()).toContainText(
    /operational|category|inventory|cash|supplier|revenue|workspace|attention/i
  );

  if (returnedFollowUps.length) {
    await expect(page.locator(".owner-assistant-shortcut").first()).toContainText(returnedFollowUps[0]);
  }

  const latestActionButtons = latestAssistantMessage.locator(".owner-assistant-action");
  await expect(latestActionButtons.first()).toBeVisible();
  const selectedActionLabel = await latestActionButtons.first().locator("strong").innerText();
  await latestActionButtons.first().click();
  await expect(page.locator(".assistant-action-banner")).toContainText(selectedActionLabel);
});
