const { webkit, chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await (
    process.env.BROWSER_ENGINE === "chromium" ? chromium : webkit
  ).launch();
  const passed = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    async function check(name) {
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
        name,
      );
      passed.push(name);
    }
    await page.goto(process.env.DEMO_URL || "http://127.0.0.1:4330");
    await page.locator(".book-card").first().waitFor();
    await check("library");
    await page
      .getByRole("button", { name: "Open The Signal Room", exact: true })
      .click();
    await check("reader");
    await page.locator("#appearance-open").click();
    await check("appearance");
    await page.locator("#theme").selectOption("light");
    await check("light appearance");
    await page.locator("#appearance [data-close]").click();
    await check("light reader");
    await page.locator("#audio-open").click();
    await check("audio controls");
    await page.locator("#audio-dialog [data-close]").click();
    await page.locator("#contents-open").click();
    await check("contents");
    await page.locator("#contents [data-close]").click();
    await page.locator("#library-back").click();
    await check("light library");
    await page.locator("#import-open").click();
    await page.locator("#discover").click();
    await check("importer");
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(
      "test-results/accessibility.json",
      JSON.stringify({ checks: passed, violations: [] }, null, 2),
    );
    console.log("PASS axe:", passed.join(", "));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
