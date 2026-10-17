const { webkit, chromium, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { createHash } = require("node:crypto"),
  { strToU8 } = require("fflate");
const { epub } = require("./fixtures.cjs");
const origin = process.env.DEMO_URL || "http://127.0.0.1:34341";
const result = {
  origin,
  passed: [],
  requests: [],
  providerReports: [],
  providerWarnings: [],
  errors: [],
};
fs.mkdirSync("test-results", { recursive: true });
const ready = (p) =>
  p.waitForFunction(() => window.ReaderNarration?.page().ready);
const show = async (p) => {
  if (await p.locator("#revealChrome").isVisible())
    await p.locator("#revealChrome").click();
};
const pass = (s) => {
  result.passed.push(s);
  console.log("PASS", s);
};
async function importBook(p, bytes, name = "local.epub") {
  await p.locator("#epubFile").setInputFiles({
    name,
    mimeType: "application/epub+zip",
    buffer: Buffer.from(bytes),
  });
  await p.locator("#uploadForm button").click();
  await expect(p.locator("#uploadStatus")).toContainText(
    /Book added|already in your library/,
    { timeout: 30000 },
  );
}
async function swipe(p, name, direction) {
  const r = await p.locator("#readingFrame").boundingBox(),
    x = Math.round(r.x + r.width * (direction > 0 ? 0.82 : 0.18)),
    y = Math.round(r.y + r.height * 0.45),
    end = x + (direction > 0 ? -1 : 1) * Math.round(r.width * 0.5);
  const session =
    name === "webkit"
      ? p._connection.toImpl(p).delegate._pageProxySession
      : await p.context().newCDPSession(p);
  await p.locator("#readingFrame").evaluate((f) => {
    window.trustedTouch = [];
    f.contentDocument.addEventListener(
      "touchstart",
      (e) => window.trustedTouch.push(e.isTrusted),
      { once: true },
    );
    f.addEventListener(
      "touchstart",
      (e) => window.trustedTouch.push(e.isTrusted),
      { once: true },
    );
  });
  const send = (type, xx) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd" && name !== "webkit" ? [] : [{ id: 1, x: xx, y }],
    });
  await send("touchStart", x);
  for (let i = 1; i <= 8; i++)
    await send("touchMove", Math.round(x + ((end - x) * i) / 8));
  await send("touchEnd", end);
  await p.waitForFunction(
    () => !ReaderNarration.page().turning && !ReaderNarration.page().dragging,
  );
  assert(
    await p.evaluate(
      () =>
        window.trustedTouch.length > 0 && window.trustedTouch.every(Boolean),
    ),
    "Touch must be native/trusted in child document or iframe whitespace",
  );
}
(async () => {
  for (const [name, engine] of [
    ["webkit", webkit],
    ["chromium", chromium],
  ]) {
    if (process.env.BROWSER_ENGINE && process.env.BROWSER_ENGINE !== name)
      continue;
    const browser = await engine.launch();
    try {
      for (const width of [320, 390, 430, 844, 1440]) {
        const context = await browser.newContext({
            viewport: { width, height: width === 844 ? 430 : 844 },
            hasTouch: true,
            isMobile: width < 900,
            reducedMotion: "reduce",
          }),
          p = await context.newPage();
        let securityProbe = false;
        const bodies = [],
          verifiedAssets = new Set();
        const workerPath = JSON.parse(
          fs.readFileSync("dist/asset-manifest.json"),
        ).assets.find((a) => a.source === "epub-worker.js").path;
        let providerPolicy = false;
        const reportOnly = [];
        p.on("pageerror", (e) => result.errors.push(e.message));
        p.on("console", (msg) => {
          if (msg.type() !== "error") return;
          const t = msg.text(),
            where = msg.location().url;
          if (
            securityProbe &&
            /Content Security Policy|script-src|Refused to execute/i.test(t)
          )
            return;
          if (
            new URL(origin).hostname === "reader.parampathak.com" &&
            t.startsWith("[Report Only]")
          ) {
            reportOnly.push(t);
            return;
          }
          if (
            new URL(origin).hostname === "reader.parampathak.com" &&
            where.startsWith("https://csp-reporting.cloudflare.com/") &&
            /Could not resolve hostname/.test(t)
          ) {
            result.providerWarnings.push({ type: "delivery", message: t });
            return;
          }
          result.errors.push(t);
        });
        context.on("request", (r) => {
          const u = new URL(r.url());
          if (u.protocol === "blob:" || u.protocol === "data:") return;
          const provider =
            u.origin === "https://csp-reporting.cloudflare.com" &&
            r.method() === "POST" &&
            /application\/(csp-report|reports\+json)/.test(
              r.headers()["content-type"] || "",
            );
          if (
            provider &&
            new URL(origin).hostname === "reader.parampathak.com"
          ) {
            result.providerReports.push({
              origin: u.origin,
              method: r.method(),
            });
            return;
          }
          result.requests.push({
            origin: u.origin,
            path: u.pathname,
            method: r.method(),
            query: u.search,
          });
          assert.equal(
            u.origin,
            new URL(origin).origin,
            "Unexpected network request",
          );
          assert.equal(
            r.method(),
            "GET",
            "No uploads or API writes are permitted",
          );
          assert(
            !u.pathname.startsWith("/api/"),
            "Local adapter must not issue HTTP API calls",
          );
          if (u.pathname === "/reader.html")
            assert.equal(u.search, "", "Book IDs must stay in URL fragments");
        });
        p.on("response", (r) => {
          const assetPath = new URL(r.url()).pathname;
          // Dedicated workers terminate after extraction; their response body can
          // disappear from the driver. The release verifier checks worker bytes.
          // Shared vendor bytes were already verified in the main document.
          if (assetPath === workerPath || verifiedAssets.has(assetPath)) return;
          if (r.request().isNavigationRequest())
            bodies.push(
              r.allHeaders().then((h) => {
                if (
                  h["content-security-policy-report-only"] &&
                  [
                    h["content-security-policy-report-only"],
                    h["report-to"],
                    h["reporting-endpoints"],
                  ]
                    .join(" ")
                    .includes("https://csp-reporting.cloudflare.com/")
                )
                  providerPolicy = true;
              }),
            );
          if (
            /\/assets\/[^/]+\.[a-f0-9]{12}\.(js|css)$/.test(
              new URL(r.url()).pathname,
            )
          )
            bodies.push(
              r
                .body()
                .then((b) => {
                  assert(
                    b.equals(
                      fs.readFileSync("dist" + new URL(r.url()).pathname),
                    ),
                    "Stale browser asset",
                  );
                  verifiedAssets.add(assetPath);
                })
                .catch((e) => result.errors.push(assetPath + ": " + e.message)),
            );
        });
        await p.goto(origin);
        await expect(p.locator(".book-card")).toHaveCount(1);
        await expect(p.locator(".browser-mode")).toContainText(
          "Browser Reader Mode",
        );
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await p.locator(".book-title").click();
        await ready(p);
        await expect(p.locator("#readingStatus")).toContainText("Page 1/");
        const first = await p.locator("#readingStatus").textContent();
        await swipe(p, name, 1);
        await expect(p.locator("#readingStatus")).not.toHaveText(first);
        await swipe(p, name, -1);
        await expect(p.locator("#readingStatus")).toHaveText(first);
        const tapRect = await p.locator("#readingFrame").boundingBox();
        await p.touchscreen.tap(tapRect.x + width * 0.91, tapRect.y + 180);
        await expect(p.locator("#readingStatus")).not.toHaveText(first);
        await p.waitForTimeout(900);
        const anchor = await p.evaluate(() => ReaderNarration.page().anchor);
        await p.reload();
        await ready(p);
        assert.equal(
          await p.evaluate(() => ReaderNarration.page().anchor),
          anchor,
        );
        await show(p);
        await p.locator("#dockSettings").click();
        await p.locator("#theme").selectOption("sepia");
        await p.locator("#fontSize").fill("24");
        await p.locator("#fontSize").dispatchEvent("change");
        await p.locator("#closeSettings").click();
        assert.equal(
          await p.locator("body").getAttribute("data-theme"),
          "sepia",
        );
        await p.reload();
        await ready(p);
        assert.equal(
          await p.locator("body").getAttribute("data-theme"),
          "sepia",
        );
        await show(p);
        await p.locator("#bookmarkToggle").click();
        await expect
          .poll(() =>
            p.evaluate(
              async () =>
                (
                  await BrowserLibrary.api(
                    "/api/books/" + ReaderNarration.bookId + "/bookmarks",
                  )
                ).items.length,
            ),
          )
          .toBe(1);
        await p.locator("#dockContents").click();
        await p.locator("#showBookmarks").click();
        await expect(p.locator("#sectionList button")).toHaveCount(2);
        await p.locator("#closeContents").click();
        pass(
          `${name} ${width}: actual library/reader, trusted touch swipe both directions, tap, page/anchor reload, themes/settings and bookmark`,
        );
        if (width === 390) {
          await p.goto(origin + "/reader.html#book=signal&section=1");
          await ready(p);
          assert(
            await p
              .locator("#sampleAudio")
              .evaluate((a) => a.paused && !a.currentSrc),
          );
          assert(!(await p.locator("#readerMini").isVisible()));
          await show(p);
          await p.locator("#dockListen").click();
          await p.waitForFunction(
            () =>
              !document.querySelector("audio").paused &&
              document.querySelector("audio").currentTime > 0.3,
          );
          await expect(p.locator("#dockListen")).toHaveAttribute(
            "data-playing",
            "true",
          );
          assert(await p.locator("#readerMini").isVisible());
          await p.locator("#readerMiniExpand").click();
          await p.locator("#audioSpeed").selectOption("2");
          assert.equal(
            await p.locator("audio").evaluate((a) => a.playbackRate),
            2,
          );
          await p.locator("#audioForward").click();
          await expect
            .poll(() => p.locator("audio").evaluate((a) => a.currentTime))
            .toBeGreaterThan(14);
          await p.locator("#audioBack").click();
          assert(await p.locator("audio").evaluate((a) => a.currentTime < 8));
          await p.locator("#audioPlay").click();
          await expect(p.locator("#dockListen")).toHaveAttribute(
            "data-playing",
            "false",
          );
          assert(await p.locator("audio").evaluate((a) => a.paused));
          const paused = await p
            .locator("audio")
            .evaluate((a) => a.currentTime);
          await p.locator("#audioPlay").click();
          await expect(p.locator("#dockListen")).toHaveAttribute(
            "data-playing",
            "true",
          );
          await p.waitForFunction(
            (time) => {
              const audio = document.querySelector("audio");
              return !audio.paused && audio.currentTime > time;
            },
            paused,
          );
          assert(
            await p
              .locator("audio")
              .evaluate((a, v) => a.currentTime >= v - 0.12, paused),
          );
          await p.locator("#closeAudio").click();
          await p.locator("#dockContents").click();
          assert(await p.locator("audio").evaluate((a) => !a.paused));
          await p.locator("#closeContents").click();
          for (let i = 0; i < 3; i++) {
            await p.locator("#dockListen").click();
            try {
              await expect(p.locator("#readerMini")).toBeHidden();
              await expect(p.locator("#dockListen")).toHaveAttribute(
                "data-playing",
                "false",
              );
              assert(await p.locator("audio").evaluate((a) => a.paused));
            } catch (error) {
              console.error("Headphone OFF state", await p.evaluate(() => ({
                miniHidden: document.querySelector("#readerMini").hidden,
                engaged: document.body.dataset.audioEngaged,
                icon: document.querySelector("#dockListen").dataset.playing,
                paused: document.querySelector("audio").paused,
                ended: document.querySelector("audio").ended,
                time: document.querySelector("audio").currentTime,
              })));
              throw error;
            }
            await p.locator("#dockListen").click();
            // paused=false can precede the native playing event / play promise.
            await expect(p.locator("#dockListen")).toHaveAttribute(
              "data-playing",
              "true",
            );
            await expect(p.locator("#readerMini")).toBeVisible();
          }
          await p.locator("#dockListen").click();
          assert(await p.locator("audio").evaluate((a) => a.paused));
          assert.equal(await p.locator("audio").count(), 1);
          await p.locator("#dockListen").click();
          await p.waitForFunction(
            () => !document.querySelector("audio").paused,
          );
          await p.locator("#readerMiniExpand").click();
          await p.locator("#audioSeek").fill("999");
          await p.waitForFunction(() => document.querySelector("audio").ended);
          await expect(p.locator("#readerMini")).toBeHidden();
          await p.locator("#closeAudio").click();
          await p.locator("audio").evaluate((a) => {
            window.replayReset = null;
            a.addEventListener(
              "loadedmetadata",
              () => (window.replayReset = a.currentTime),
              { once: true },
            );
          });
          await p.locator("#dockListen").click();
          await p.waitForFunction(
            () =>
              window.replayReset !== null &&
              window.replayReset <= 0.08 &&
              !document.querySelector("audio").paused,
          );
          await p.locator("#dockListen").click();
          await p.screenshot({
            path: `test-results/${name}-sample-reader.png`,
          });
          pass(
            `${name}: native licensed neural playback, pause/resume, headphones, single mini-player, ±15s, 2x and Contents without interruption`,
          );
          await p.goto(origin);
          const importedArchive = epub({ attack: true });
          await importBook(p, importedArchive);
          await expect(p.locator(".book-card")).toHaveCount(2);
          await p
            .getByRole("link", { name: "Local Lighthouse", exact: true })
            .click();
          await ready(p);
          const bookId = await p.evaluate(() => ReaderNarration.bookId);
          assert(bookId.startsWith("epub-"));
          assert.equal(
            await p
              .frameLocator("#readingFrame")
              .locator(
                'script,iframe,form,svg,style:not(#reader-style),[onerror],[src^="http"]',
              )
              .count(),
            0,
          );
          assert(!(await p.evaluate(() => window.__epubExecuted)));
          await expect(
            p.frameLocator("#readingFrame").locator("img"),
          ).toHaveCount(1);
          assert(
            await p
              .frameLocator("#readingFrame")
              .locator("img")
              .evaluate((i) => i.complete && i.naturalWidth === 32),
          );
          securityProbe = true;
          await p.locator("#readingFrame").evaluate((f) => {
            window.__cspTest = false;
            const s = f.contentDocument.createElement("script");
            s.textContent = "parent.__cspTest=true";
            f.contentDocument.body.append(s);
          });
          await p.waitForTimeout(100);
          assert.equal(await p.evaluate(() => window.__cspTest), false);
          securityProbe = false;
          await swipe(p, name, 1);
          await p.waitForTimeout(900);
          const localAnchor = await p.evaluate(
            () => ReaderNarration.page().anchor,
          );
          await p.reload();
          await ready(p);
          assert.equal(
            await p.evaluate(() => ReaderNarration.page().anchor),
            localAnchor,
          );
          await show(p);
          await p.locator("#dockListen").click();
          await expect(p.locator("#samplePlayer")).toBeVisible();
          assert(
            await p.locator("audio").evaluate((a) => a.paused && !a.currentSrc),
          );
          await p.locator("#closeAudio").click();
          await p.locator("#dockContents").click();
          await p.locator("#sectionList button").nth(1).click();
          await p.waitForFunction(
            () =>
              ReaderNarration.page().ready &&
              ReaderNarration.page().section_id === 2,
          );
          assert.equal(
            await p.evaluate(() => ReaderNarration.page().section_id),
            2,
          );
          await swipe(p, name, -1);
          await p.waitForFunction(
            () =>
              ReaderNarration.page().ready &&
              ReaderNarration.page().section_id === 1,
          );
          await swipe(p, name, 1);
          await p.waitForFunction(
            () =>
              ReaderNarration.page().ready &&
              ReaderNarration.page().section_id === 2,
          );
          await expect
            .poll(() =>
              p.evaluate(
                async () =>
                  (
                    await BrowserLibrary.api(
                      "/api/books/" + ReaderNarration.bookId,
                    )
                  ).progress.section_id,
              ),
            )
            .toBe(2);
          await p.screenshot({ path: `test-results/${name}-local-epub.png` });
          await p.goto(origin);
          await p
            .getByRole("button", {
              name: "Manage Local Lighthouse",
              exact: true,
            })
            .click();
          const download = p.waitForEvent("download");
          await p
            .getByRole("button", { name: "Export local backup", exact: true })
            .click();
          const saved = await download;
          assert.equal(await saved.failure(), null);
          const backup = fs.readFileSync(await saved.path());
          assert(
            Buffer.from(JSON.parse(backup).epub, "base64").equals(
              Buffer.from(importedArchive),
            ),
            "Backup preserves exact original EPUB bytes",
          );
          assert.equal(JSON.parse(backup).state.section_id, 2);
          await p.evaluate((id) => BrowserLibrary.remove(id), bookId);
          await p.reload();
          await expect(p.locator(".book-card")).toHaveCount(1);
          await p.locator("#restoreBackup").setInputFiles({
            name: "backup.json",
            mimeType: "application/json",
            buffer: backup,
          });
          await expect(p.locator(".book-card")).toHaveCount(2);
          pass(
            `${name}: real hostile EPUB import, no uploads/external content, CSP script blocking, local recovery, chapter boundaries, no imported-book TTS, backup/delete/restore`,
          );
          for (const [bytes, message] of [
            [epub({ extra: { "../escape": strToU8("bad") } }), /Unsafe/],
            [
              epub({ extra: { "large.bin": new Uint8Array(9 * 1024 * 1024) } }),
              /oversized/,
            ],
            [Buffer.from("not a zip"), /Invalid/],
            [
              epub({
                extra: {
                  "OEBPS/c1.xhtml": strToU8(
                    '<!DOCTYPE html [<!ENTITY probe SYSTEM "https://example.invalid/entity">]><html><body>&probe;</body></html>',
                  ),
                },
              }),
              /Unsupported XML/,
            ],
            [
              (() => {
                const bytes = Buffer.from(epub());
                for (let i = 0; i < bytes.length - 20; i++)
                  if (bytes.readUInt32LE(i) === 0x02014b50) {
                    bytes.writeUInt32LE(
                      (bytes.readUInt32LE(i + 16) ^ 1) >>> 0,
                      i + 16,
                    );
                    break;
                  }
                return bytes;
              })(),
              /Corrupt/,
            ],
          ]) {
            await p.locator("#epubFile").setInputFiles({
              name: "bad.epub",
              mimeType: "application/epub+zip",
              buffer: Buffer.from(bytes),
            });
            await p.locator("#uploadForm button").click();
            await expect(p.locator("#uploadStatus")).toContainText(message);
            await expect(p.locator(".book-card")).toHaveCount(2);
          }
          const blocked = await browser.newContext();
          await blocked.addInitScript(() => {
            indexedDB.open = () => {
              throw Error("Storage intentionally unavailable");
            };
          });
          const bp = await blocked.newPage();
          await bp.goto(origin);
          await expect(bp.locator("#storageStatus")).toContainText(
            /unavailable/,
          );
          await blocked.close();
          await p.evaluate(() => {
            window.originalPut = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...args) {
              if (this.name === "files")
                throw new DOMException(
                  "Controlled storage quota test",
                  "QuotaExceededError",
                );
              return window.originalPut.apply(this, args);
            };
          });
          await p.locator("#epubFile").setInputFiles({
            name: "quota.epub",
            mimeType: "application/epub+zip",
            buffer: Buffer.from(epub({ title: "Quota Test" })),
          });
          await p.locator("#uploadForm button").click();
          await expect(p.locator("#uploadStatus")).toContainText(
            "no partial book",
          );
          await p.evaluate(() => {
            IDBObjectStore.prototype.put = window.originalPut;
          });
          assert.equal(
            await p.evaluate(async () => (await BrowserLibrary.all()).length),
            2,
            "Failed transaction cannot leave an orphan book",
          );
          pass(
            `${name}: traversal, expansion bomb, corrupt archive, storage-unavailable and quota rollback without partial imports`,
          );
          await importBook(
            p,
            epub({ chapters: 3001, title: "Long Local Book" }),
            "long.epub",
          );
          await p
            .getByRole("link", { name: "Long Local Book", exact: true })
            .click();
          await ready(p);
          await show(p);
          await p.locator("#dockContents").click();
          await expect(p.locator("#contentsPage")).toContainText("/ 3001");
          const rect = await p.locator("#sectionList").boundingBox(),
            panel = await p.locator("#contentsPanel").boundingBox();
          assert(rect.height > 250);
          assert(panel.y + panel.height - (rect.y + rect.height) < 90);
          assert((await p.locator("#sectionList button").count()) <= 100);
          await p
            .locator("#sectionList")
            .evaluate((e) => (e.scrollTop = e.scrollHeight - e.clientHeight));
          await expect(p.locator("#sectionList button").last()).toContainText(
            "3001.",
          );
          await p.setViewportSize({ width: 430, height: 932 });
          assert((await p.locator("#sectionList").boundingBox()).height > 300);
          await p.screenshot({
            path: `test-results/${name}-contents-3001.png`,
          });
          await p.goto(origin);
          await importBook(
            p,
            epub({ title: "Legacy EPUB", navVersion: 2 }),
            "legacy.epub",
          );
          await p
            .getByRole("link", { name: "Legacy EPUB", exact: true })
            .click();
          await ready(p);
          await show(p);
          await p.locator("#dockContents").click();
          await p.locator("#tocTab").click();
          await expect(p.locator("#sectionList button").first()).toHaveText(
            "Legacy chapter 1",
          );
          pass(
            `${name}: real 3,001-chapter EPUB, actual full-height virtualized list, end scrolling and resize`,
          );
        }
        await Promise.all(bodies);
        if (reportOnly.length) {
          assert(
            providerPolicy,
            "Report-only console diagnostics need the observed Cloudflare policy",
          );
          result.providerWarnings.push({
            engine: name,
            width,
            messages: reportOnly,
          });
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(result.errors, []);
  fs.writeFileSync(
    "test-results/browser-results.json",
    JSON.stringify(result, null, 2),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
