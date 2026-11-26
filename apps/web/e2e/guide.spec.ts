import { expect, test } from "@playwright/test";
import { publishedGuide } from "../src/fixtures/guide-fixture";

const guideId = publishedGuide.metadata.guideId;
const view = {
  guide: publishedGuide,
  catalogReleaseId: publishedGuide.metadata.dataReleaseId,
  current: true,
  names: {
    "gem:Fixture/Gems/Main": "Main Skill",
    "ascendancy:fixture_asc": "Fixture Ascendancy",
    "gem:Fixture/Gems/Support": "Support Skill",
  },
  results: {
    "calc-1": {
      calcId: "calc-1",
      pobVersion: "v9.9.9",
      dataReleaseId: publishedGuide.metadata.dataReleaseId,
      calcProfile: "default",
      inputHash: "a".repeat(64),
      computedAt: "2026-01-01T00:00:00Z",
      stats: { FixtureStatA: 1234.5 },
      warnings: [],
      unsupportedMods: [],
    },
  },
  unresolved: [],
};

test("a saved guide opens in the window with its stages and numbers", async ({ page }) => {
  await page.route(`**/api/guides/${guideId}/view`, (route) => route.fulfill({ json: view }));
  await page.goto(`/#/guide/${guideId}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Fixture Ascendancy");
  await expect(page.getByText("1,234.5").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as .build file" })).toBeVisible();
  const shot = process.env["GUIDE_SHOT"];
  if (shot !== undefined) await page.screenshot({ path: shot, fullPage: true });
});
