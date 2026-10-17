// Real local EPUBs and UI interactions; no seeded or fabricated library records.
const { chromium, webkit, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { epub } = require('./fixtures.cjs');
const origin = process.env.DEMO_URL || 'http://127.0.0.1:4330';
const result = { origin, passed: [], measurements: [], errors: [], providerReports: [] };
fs.mkdirSync('test-results', { recursive: true });
const pass = s => { result.passed.push(s); console.log('PASS', s); };
async function shot(p, name, fullPage = true) {
  await p.locator('.book-cover img').evaluateAll(images => Promise.all(images.map(i => i.decode().catch(() => {}))));
  await p.screenshot({ path: `test-results/polish-${name}.png`, fullPage });
}
async function contained(p, selectors) {
  const measurements = await p.locator(selectors).evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => {
    const r = n.getBoundingClientRect();
    return { tag: n.id || n.className || n.tagName, left: r.left, right: r.right, width: r.width, viewport: innerWidth };
  }));
  for (const r of measurements) assert(r.left >= -1 && r.right <= r.viewport + 1, JSON.stringify(r));
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
  return measurements;
}
async function importBook(p, bytes, expected, filename = 'original-qa.epub') {
  const chooser = p.waitForEvent('filechooser');
  await p.getByRole('button', { name: 'Import EPUB', exact: true }).click();
  await (await chooser).setFiles({ name: filename, mimeType: 'application/epub+zip', buffer: Buffer.from(bytes) });
  await expect(p.locator('#bookCount')).toHaveText(`(${expected})`, { timeout: 30000 });
  await expect(p.locator('#uploadStatus')).toContainText(/Book added|already in your library/);
  await expect(p.locator('#importEpub')).toBeEnabled();
  await expect(p.locator('#epubFile')).toHaveValue('');
}
async function menu(p, title) {
  const owner = p.getByRole('button', { name: `Manage ${title}`, exact: true });
  await owner.click();
  await expect(p.locator('.book-menu-dialog')).toBeVisible();
  await contained(p, '.book-menu-dialog, .book-menu-dialog button');
  return owner;
}
async function axe(p, name) {
  const scan = await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  assert.deepEqual(scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)})),[],name);
}
(async () => {
  for (const [name, engine] of Object.entries({ webkit, chromium })) {
    if (process.env.BROWSER_ENGINE && process.env.BROWSER_ENGINE !== name) continue;
    const browser = await engine.launch();
    try {
      const c = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
      const p = await c.newPage();
      let providerPolicy = false;
      p.on('response', async r => {
        if (!r.request().isNavigationRequest()) return;
        const h = await r.allHeaders();
        if (h['content-security-policy-report-only'] && [h['content-security-policy-report-only'],h['report-to'],h['reporting-endpoints']].join(' ').includes('https://csp-reporting.cloudflare.com/')) providerPolicy = true;
      });
      p.on('pageerror', e=>result.errors.push(e.message));
      p.on('console', m=>{
        if(m.type()!=='error')return;
        if(new URL(origin).hostname==='reader.parampathak.com' && (m.text().startsWith('[Report Only]') || (m.location().url.startsWith('https://csp-reporting.cloudflare.com/') && /Could not resolve hostname/.test(m.text()))))return;
        result.errors.push(m.text());
      });
      c.on('request', r=>{
        const u=new URL(r.url());
        if(['blob:','data:'].includes(u.protocol))return;
        if(new URL(origin).hostname==='reader.parampathak.com' && u.origin==='https://csp-reporting.cloudflare.com' && r.method()==='POST' && /application\/(csp-report|reports\+json)/.test(r.headers()['content-type']||'')) {
          result.providerReports.push({origin:u.origin,method:r.method()}); return;
        }
        if(u.origin!==new URL(origin).origin || r.method()!=='GET' || u.pathname.startsWith('/api/') || (u.pathname==='/reader.html' && u.search))result.errors.push(`Unexpected request: ${r.method()} ${u.origin}${u.pathname}`);
      });
      await p.goto(origin);
      await expect(p.locator('.book-card')).toHaveCount(1);
      for(const width of [320,375,390,768,1280,1920]) {
        await p.setViewportSize({width,height:width<768?844:1000});
        await expect(p.locator('#libraryPagination')).toBeHidden();
        await expect(p.getByRole('button',{name:'Import EPUB',exact:true})).toHaveCount(1);
        assert.equal(await p.getByText('Import from device',{exact:true}).count(),0);
        const notice=p.locator('.browser-mode');
        await expect(notice).not.toContainText('Andrew');
        await expect(notice.locator('.storage-note')).toBeVisible();
        await expect(notice).toContainText('books, bookmarks, and reading progress stay on this device');
        const bounds=await contained(p,'.topbar a, .upload-card, .section-heading, .action-row select, .book-card, .browser-mode');
        const noticeHeight=await notice.evaluate(n=>n.getBoundingClientRect().height);
        assert(noticeHeight<=195,`Notice too tall at ${width}: ${noticeHeight}`);
        const details=await p.locator('.book-details').evaluate(n=>({text:n.textContent,scroll:n.scrollHeight,height:n.clientHeight,whiteSpace:getComputedStyle(n).whiteSpace}));
        assert.equal(details.text,'3 sections · Audiobook sample');
        assert(details.scroll<=details.height+1 && details.whiteSpace==='normal','Sample details must wrap, not clip');
        result.measurements.push({engine:name,width,noticeHeight,bounds});
        if([390,1280].includes(width)) await shot(p,`${name}-library-${width}`);
      }
      pass(`${name}: all six widths, contained header/controls, concise notice, one import action, readable sample metadata, hidden single-page navigation`);
      await p.setViewportSize({width:390,height:844});
      await p.locator('.browser-mode summary').click();
      await expect(p.locator('.browser-mode details')).toContainText("Live audiobook generation, online novel importing, and cross-device syncing aren't available");
      await expect(p.locator('.browser-mode details p')).toBeVisible();
      await axe(p,'Expanded notice');
      await shot(p,`${name}-notice-expanded`);
      await p.locator('.browser-mode summary').click();
      const sampleOwner=await menu(p,'The Signal Room');
      await p.keyboard.press('Escape');
      await expect(p.locator('.book-menu-dialog')).not.toBeVisible();
      await expect(sampleOwner).toBeFocused();
      // Selecting no file must do nothing, with the same primary action reusable.
      const canceled=p.waitForEvent('filechooser');
      await p.locator('#importEpub').click();
      await (await canceled).setFiles([]);
      await expect(p.locator('#bookCount')).toHaveText('(1)');
      const longTitle=('灯台の記録 — The Lighthouse & the Unbroken Record '+ 'A very long original title '.repeat(6)).trim();
      const longAuthor=('Original QA Author — '+ 'A deliberately long Unicode name 海 '.repeat(6)).trim();
      const bytes=epub({title:longTitle,author:longAuthor,chapters:2});
      await importBook(p,bytes,2,'very-long-original-filename-'.repeat(6)+'.epub');
      await shot(p,`${name}-import-and-long-title`);
      await expect(p.getByRole('link',{name:longTitle,exact:true})).toHaveAttribute('title',longTitle);
      await expect(p.locator('.book-author').filter({hasText:longAuthor})).toHaveAttribute('title',longAuthor);
      await importBook(p,bytes,2);
      await expect(p.locator('#uploadStatus')).toContainText('already in your library');
      await menu(p,longTitle);
      await p.getByRole('button',{name:'Favorite',exact:true}).click();
      await p.locator('#favoritesOnly').check();
      await expect(p.locator('.book-card')).toHaveCount(1);
      await expect(p.locator('#libraryPagination')).toBeHidden();
      await p.locator('#favoritesOnly').uncheck();
      await expect(p.locator('.book-card')).toHaveCount(2);
      await importBook(p,epub({title:'No artwork — Original QA',author:'',cover:false}),3);
      const missing=p.locator('.book-card').filter({has:p.getByRole('link',{name:'No artwork — Original QA',exact:true})});
      await expect(missing.locator('.book-author')).toHaveText('Unknown author');
      await expect(missing.locator('.cover-fallback')).toHaveText('No artwork');
      await contained(p,'.book-card, .book-details');
      await axe(p,'Imported metadata and missing cover');
      await shot(p,`${name}-multiple-books-mobile`);
      await p.setViewportSize({width:1280,height:1000});
      await shot(p,`${name}-multiple-books-desktop`);
      pass(`${name}: real picker imports, cancel, duplicate prevention, long/Unicode title/author/filename, missing metadata/artwork, keyboard menu/favorites and accessibility`);
      // Import enough actual independent EPUBs to exercise all three real pages.
      for(let i=1;i<=47;i++) await importBook(p,epub({chapters:1,title:`QA Shelf ${String(i).padStart(2,'0')}`}),i+3);
      await p.locator('#librarySort').selectOption('title');
      await expect(p.locator('#pageInfo')).toHaveText('1–24 of 50');
      await expect(p.locator('.book-title').first()).toHaveText('No artwork — Original QA');
      await expect(p.locator('#libraryPagination')).toBeVisible();
      const first=await p.locator('.book-title').first().textContent();
      await p.locator('#nextPage').click();
      await expect(p.locator('#pageInfo')).toHaveText('25–48 of 50');
      await p.locator('#nextPage').click();
      await expect(p.locator('#pageInfo')).toHaveText('49–50 of 50');
      await expect(p.locator('#nextPage')).toBeDisabled();
      await p.locator('#previousPage').click();
      await expect(p.locator('#pageInfo')).toHaveText('25–48 of 50');
      await p.locator('#previousPage').click();
      await expect(p.locator('.book-title').first()).toHaveText(first);
      await p.locator('#bookSearch').fill('QA Shelf');
      await expect(p.locator('#pageInfo')).toHaveText('1–24 of 47');
      await p.locator('#nextPage').click();
      await expect(p.locator('#pageInfo')).toHaveText('25–47 of 47');
      await expect(p.locator('.book-title').first()).toHaveText('QA Shelf 25');
      await p.locator('#bookKind').selectOption('epub');
      await expect(p.locator('#pageInfo')).toHaveText('1–24 of 47');
      await p.locator('#bookSearch').fill('nonexistent original QA title');
      await expect(p.locator('.book-card')).toHaveCount(0);
      await expect(p.locator('#libraryStatus')).toContainText('No matching books');
      await expect(p.locator('#libraryPagination')).toBeHidden();
      await p.locator('#bookSearch').fill('');
      await expect(p.locator('#pageInfo')).toHaveText('1–24 of 49');
      await p.locator('#bookKind').selectOption('');
      await expect(p.locator('#pageInfo')).toHaveText('1–24 of 50');
      await p.locator('#nextPage').click();
      await expect(p.locator('#pageInfo')).toHaveText('25–48 of 50');
      await p.locator('#nextPage').click();
      await expect(p.locator('#pageInfo')).toHaveText('49–50 of 50');
      // Filter to imported EPUBs so deletion cannot target the protected sample.
      await p.locator('#bookKind').selectOption('epub');
      await expect(p.locator('#pageInfo')).toHaveText('1–24 of 49');
      await p.locator('#nextPage').click();
      await expect(p.locator('#pageInfo')).toHaveText('25–48 of 49');
      await p.locator('#nextPage').click();
      await expect(p.locator('#pageInfo')).toHaveText('49–49 of 49');
      const last=await p.locator('.book-title').textContent();
      await menu(p,last);
      p.once('dialog',d=>d.accept());
      await p.getByRole('button',{name:'Delete local book',exact:true}).click();
      await expect(p.locator('#pageInfo')).toHaveText('25–48 of 48');
      await expect(p.locator('.book-card')).toHaveCount(24);
      await expect(p.locator('#librarySort')).toHaveValue('title');
      await expect(p.locator('#bookKind')).toHaveValue('epub');
      await p.locator('#favoritesOnly').check();
      await expect(p.locator('.book-card')).toHaveCount(last===longTitle?0:1);
      await expect(p.locator('#libraryPagination')).toBeHidden();
      await p.locator('#favoritesOnly').uncheck();
      await expect(p.locator('#pageInfo')).toHaveText('1–24 of 48');
      await shot(p,`${name}-large-library`);
      pass(`${name}: 50 real books, three pages, stable sort/search/filter/favorites, empty results and last-page deletion recovery`);
      // Return to the original sample and capture actual playback + reading themes.
      await p.locator('#bookKind').selectOption('');
      await p.locator('#bookSearch').fill('The Signal Room');
      await expect(p.locator('.book-card')).toHaveCount(1);
      await p.getByRole('link',{name:'The Signal Room',exact:true}).click();
      await p.waitForFunction(()=>window.ReaderNarration?.page().ready);
      const initialAnchor=await p.evaluate(()=>ReaderNarration.page().anchor);
      for(const expanded of [true,false]) {
        await p.locator('.browser-mode summary').click();
        await expect(p.locator('.browser-mode details')).toHaveJSProperty('open',expanded);
        await expect.poll(()=>p.evaluate(()=>{
          const d=document.querySelector('#readingFrame').contentDocument;
          return document.querySelector('#readingStatus').textContent.endsWith('/'+ReaderPagination.pageCount(d.scrollingElement.scrollWidth,d.documentElement.clientWidth));
        })).toBe(true);
        assert.equal(await p.evaluate(()=>ReaderNarration.page().anchor),initialAnchor,'Disclosure reflow retains the text anchor');
      }
      await shot(p,`${name}-reader-near-black-desktop`);
      await p.setViewportSize({width:390,height:844});
      if(await p.locator('#revealChrome').isVisible())await p.locator('#revealChrome').click();
      await shot(p,`${name}-reader-near-black-mobile`);
      await p.locator('#dockSettings').click();
      await p.locator('#theme').selectOption('lightgray');
      await p.locator('#closeSettings').click();
      assert(await p.locator('#dockListen').evaluate(n=>getComputedStyle(n).color===getComputedStyle(document.body).color),'Inactive headphones must stay legible on a light background, even before first playback');
      await shot(p,`${name}-reader-light-mobile`);
      await p.locator('#dockListen').click();
      await p.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>0;});
      await expect(p.locator('#readerMiniState')).toHaveText('');
      await shot(p,`${name}-sample-playing`);
      await p.locator('#readerMiniExpand').click();
      await shot(p,`${name}-sample-player`);
      await p.locator('#audioStop').click();
      pass(`${name}: real sample cover/playback and near-black/light reading screenshots`);
      if(result.providerReports.length)assert(providerPolicy,'Provider reporting must be explained by actual response policy');
      await c.close();
    } finally { await browser.close(); }
  }
  if(!process.env.BROWSER_ENGINE || process.env.BROWSER_ENGINE==='chromium') {
    // Full Chromium's own setting is actual browser zoom, not CSS zoom or scaling.
    const c=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,viewport:{width:1280,height:900}});
    try {
      const p=c.pages()[0];
      await p.goto('chrome://settings/appearance');
      await p.locator('#zoomLevel').selectOption('2');
      await p.goto(origin);
      await p.locator('.book-title').waitFor();
      const z=await p.evaluate(()=>({innerWidth,devicePixelRatio,cssZoom:getComputedStyle(document.body).zoom}));
      assert.equal(z.innerWidth,640); assert.equal(z.devicePixelRatio,2); assert.equal(z.cssZoom,'1');
      await contained(p,'.topbar a, .upload-card, .action-row select, .book-card');
      // Full-page capture uses layout CSS width at native zoom and crops the
      // physical screenshot; viewport capture preserves the real 1280px view.
      await shot(p,'chromium-native-zoom200-library',false);
      await p.locator('.book-title').click();
      await p.waitForFunction(()=>window.ReaderNarration?.page().ready);
      await contained(p,'.reader-footer, .reader-dock button');
      const before=await p.locator('#readingStatus').textContent();
      const frame=await p.locator('#readingFrame').boundingBox();
      await p.mouse.click(frame.x+frame.width*.9,frame.y+frame.height*.5);
      await expect(p.locator('#readingStatus')).not.toHaveText(before);
      await shot(p,'chromium-native-zoom200-reader',false);
      result.measurements.push({nativeZoom:z});
      pass('chromium: actual 200% browser zoom reflows library/header/reader with working navigation');
    } finally {await c.close();}
  }
  assert.deepEqual(result.errors,[],'No unexpected application errors or book transfers');
  fs.writeFileSync('test-results/polish-results.json',JSON.stringify(result,null,2));
})().catch(e=>{fs.writeFileSync('test-results/polish-results.json',JSON.stringify({...result,failure:e.stack},null,2));console.error(e);process.exitCode=1;});
