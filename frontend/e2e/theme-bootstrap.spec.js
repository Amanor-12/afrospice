import { expect, test } from "@playwright/test";

test("dark theme bootstrap applies before the app hydrates", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("afrospice_theme", "dark");
  });

  await page.goto("/login");

  await expect
    .poll(() =>
      page.evaluate(() => ({
        bodyDark: document.body.classList.contains("dark"),
        dataTheme: document.documentElement.dataset.theme,
        themeColor:
          document.querySelector('meta[name="theme-color"]')?.getAttribute("content") || "",
      }))
    )
    .toEqual({
      bodyDark: true,
      dataTheme: "dark",
      themeColor: "#0a0c10",
    });
});
