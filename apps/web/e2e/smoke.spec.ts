import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Fonts are bundled; wait for them so screenshots never catch a fallback font.
async function open(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await page.evaluate(() => document.fonts.ready);
}

test("build overview renders on sample data", async ({ page }) => {
  await open(page, "#/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Emberweaver");
  await expect(page.getByRole("tab", { name: /Start/ })).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("Not affiliated with or endorsed by Grinding Gear Games", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("overview.png", { fullPage: true });
});

test("a failed calculation is shown as an error, not as a number", async ({ page }) => {
  await open(page, "#/");
  await page.getByRole("tab", { name: /Build-up/ }).click();
  await expect(page.getByText("Value unavailable")).toBeVisible();
  await expect(page.getByText("Worker timed out", { exact: false })).toBeVisible();
});

test("design-system gallery renders every building block", async ({ page }) => {
  await open(page, "#/design");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Design System");
  for (const title of ["Colours", "Typography", "Buttons", "Tabs", "Item Cards"]) {
    await expect(page.getByRole("region", { name: title })).toBeVisible();
  }
  await expect(page).toHaveScreenshot("design-system.png", { fullPage: true });
});
