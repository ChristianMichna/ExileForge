import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function openTree(page: Page) {
  await page.goto("/#/tree");
  await page.evaluate(() => document.fonts.ready);
  // the WebGL renderer marks its frame once the tree is drawn
  await expect(page.locator(".ef-tree__main")).toHaveAttribute("data-status", "ready", {
    timeout: 20_000,
  });
}

test("passive tree renders real tree data with the sample allocation", async ({ page }) => {
  await openTree(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Passive Tree");
  await expect(page.getByText("Sample build · made-up allocation")).toBeVisible();
  await expect(page.getByRole("region", { name: "Build-up" })).toBeVisible();
  await expect(page.getByText("Game data · poe2-", { exact: false })).toBeVisible();
  await expect(page).toHaveScreenshot("passive-tree.png");
});

test("the timeline shows a respec stage with struck-through passives", async ({ page }) => {
  await openTree(page);
  await page.getByRole("button", { name: /Early Endgame/ }).click();
  const respec = page.locator(".ef-tree__list--respec li");
  await expect(respec).toHaveCount(3);
  await respec.first().getByRole("button").click();
  await expect(page.getByRole("tooltip")).toContainText("Respec");
  await expect(page.locator(".ef-tree__main")).toHaveScreenshot("passive-tree-respec.png");
});
