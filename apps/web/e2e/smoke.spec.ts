import { expect, test } from "@playwright/test";

test("start screen renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ExileForge");
  await expect(page).toHaveScreenshot("start.png", { fullPage: true });
});
