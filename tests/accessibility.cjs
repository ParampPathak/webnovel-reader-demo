const { webkit, chromium } = require("@playwright/test"),
  AxeBuilder = require("@axe-core/playwright").default,
  assert = require("node:assert/strict"),
  fs = require("fs");
const origin = process.env.DEMO_URL || "http://127.0.0.1:34341";
(async () => {
  const passed = [];
  for (const [name, engine] of Object.entries({ webkit, chromium })) {
  if (process.env.BROWSER_ENGINE && process.env.BROWSER_ENGINE !== name) continue;
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const p = await context.newPage();
    async function check(name) {
      const a = await new AxeBuilder({ page: p })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        a.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            html: n.html,
            summary: n.failureSummary,
          })),
        })),
        [],
        name,
      );
      passed.push(`${engine.name()}: ${name}`);
    }
    await p.goto(origin);
    await p.locator(".book-title").waitFor();
    await check("actual library and Browser Reader notice");
    await p.locator(".book-title").click();
    await p.waitForFunction(() => window.ReaderNarration?.page().ready);
    await check("actual reader");
    await p.locator("#dockSettings").click();
    await check("reader settings");
    await p.locator("#theme").selectOption("light");
    await check("light settings");
    await p.locator("#closeSettings").click();
    await p.locator("#dockContents").click();
    await check("full-height contents");
    await p.locator("#closeContents").click();
    await p.locator("#dockListen").click();
    await p.waitForFunction(() => !document.querySelector("audio").paused);
    await p.locator("#readerMiniExpand").click();
    await check("sample player");
    await p.locator("#audioStop").click();
  } finally {
    await browser.close();
  }
  }
  fs.writeFileSync(
      "test-results/accessibility.json",
      JSON.stringify({ origin, passed }, null, 2),
    );
    console.log("PASS axe", passed);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
