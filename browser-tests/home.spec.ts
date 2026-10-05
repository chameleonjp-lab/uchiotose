import { expect, test } from "@playwright/test";

const homeViewports = [
  { width: 393, height: 648 },
  { width: 568, height: 320 },
  { width: 1280, height: 720 },
];

test("Home preview boots at every planned viewport", async ({ page }) => {
  await page.goto("/");

  for (const viewport of homeViewports) {
    await page.setViewportSize(viewport);

    await expect(page.getByRole("heading", { name: "ウチオトセ" })).toBeVisible();
    await expect(page.locator(".mission-data > div").nth(0).locator("strong")).toHaveText("50機");
    await expect(page.locator(".mission-data > div").nth(1).locator("strong")).toHaveText("100人");
    await expect(page.locator(".mission-data > div").nth(2).locator("strong")).toHaveText("10隻");
    await expect(page.locator("#p1-status")).toHaveText("開発中のため、まだ出撃できません。");
    await expect(page.getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "作戦開始は準備中です" })).toBeDisabled();
    await expect(page.locator("#app")).toHaveAttribute("data-screen", "home");

    await page.getByLabel("ノーマル", { exact: true }).check();
    await expect(page.locator("#app")).toHaveAttribute("data-mode", "normal");
    await page.getByLabel("イージー", { exact: true }).check();
    await expect(page.locator("#app")).toHaveAttribute("data-mode", "easy");
    await page.screenshot({ path: `docs/evidence/home-${viewport.width}x${viewport.height}.png` });

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  }
});
