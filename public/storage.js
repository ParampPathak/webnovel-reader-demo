/* In-browser repository. API-shaped calls below are function calls, NOT fetches. */
window.BrowserLibrary = (() => {
  const DB = "webnovel-browser-library-v1",
    MAX_LIBRARY = 100 * 1024 * 1024,
    urls = new Map();
  let opening,
    searchGeneration = 0;
  const fail = (message) => {
    throw Error(message);
  };
  const archives = new Map();
  async function fileEntry(id, path) {
    const direct = await get("files", [id, path]);
    if (direct) return direct;
    if (!archives.has(id)) archives.set(id, get("files", [id, "@expanded"]));
    const archive = await archives.get(id),
      index = archive?.index.find((item) => item[0] === path);
    return index
      ? { bytes: archive.bytes.subarray(index[1], index[1] + index[2]) }
      : null;
  }
  function db() {
    if (!opening)
      opening = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("books", { keyPath: "id" });
          r.result.createObjectStore("files", { keyPath: ["book", "path"] });
          r.result.createObjectStore("state", { keyPath: "id" });
        };
        r.onerror = () =>
          reject(
            Error(
              "Browser storage is unavailable. Enable site storage to keep a local library.",
            ),
          );
        r.onblocked = () =>
          reject(Error("Close other reader tabs to update local storage."));
        r.onsuccess = () => {
          r.result.onversionchange = () => r.result.close();
          resolve(r.result);
        };
      });
    return opening;
  }
  async function get(store, key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store),
        r = t.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function all() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const r = d.transaction("books").objectStore("books").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function mutate(id, change) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction("state", "readwrite"),
        s = t.objectStore("state"),
        r = s.get(id);
      let result;
      r.onsuccess = () => {
        try {
          const value = r.result || {
            id,
            version: 0,
            preferences: {},
            bookmarks: [],
          };
          result = change(value);
          s.put(value);
        } catch (e) {
          reject(e);
          t.abort();
        }
      };
      t.oncomplete = () => resolve(result);
      t.onerror = () =>
        reject(
          Error("Progress could not be saved. Browser storage may be full."),
        );
    });
  }
  const themes = ["dark", "gray", "lightgray", "light", "sepia"];
  function preferences(p = {}) {
    const out = {};
    for (const [k, values] of Object.entries({
      theme: themes,
      font: ["serif", "sans", "mono"],
      mode: ["pages", "scroll"],
      alignment: ["left", "justify"],
    }))
      if (values.includes(p[k])) out[k] = p[k];
    for (const [k, lo, hi] of [
      ["fontSize", 14, 32],
      ["lineHeight", 1.2, 2.4],
      ["width", 480, 1000],
      ["paragraphSpacing", 0.5, 2],
      ["margin", 12, 60],
    ])
      if (Number.isFinite(p[k])) out[k] = Math.max(lo, Math.min(hi, p[k]));
    for (const k of ["followAlong", "followAlongSuspended"])
      out[k] = p[k] === true;
    return out;
  }
  function progress(s = {}) {
    return {
      section_id: s.section_id || null,
      fraction: Number.isFinite(s.fraction)
        ? Math.max(0, Math.min(1, s.fraction))
        : 0,
      anchor: /^(text:\d+|epub-[\w.-]+)$/.test(s.anchor || "") ? s.anchor : "",
      version: s.version || 0,
      preferences: preferences(s.preferences),
      updated_at: s.updated_at || "",
    };
  }
  async function image(id, path) {
    const key = id + ":" + path;
    if (urls.has(key)) return urls.get(key);
    const f = await fileEntry(id, path);
    if (!f) return null;
    const type = BrowserEPUB.raster(f.bytes);
    if (!type) return null;
    const url = URL.createObjectURL(new Blob([f.bytes], { type }));
    urls.set(key, url);
    return url;
  }
  async function originalURL(id) {
    const key = id + ":original";
    if (urls.has(key)) return urls.get(key);
    const f = await get("files", [id, "@original"]);
    if (!f) fail("Original EPUB is unavailable.");
    const url = URL.createObjectURL(
      new Blob([f.bytes], { type: "application/epub+zip" }),
    );
    urls.set(key, url);
    return url;
  }
  async function describe(b) {
    const s = (await get("state", b.id)) || {};
    return {
      ...b,
      cover_url:
        b.id === "signal" ? "/assets/signal.svg" : await image(b.id, b.cover),
      source_kind: b.sample ? "sample" : "epub",
      section_count: b.sections.length,
      position_count: b.sections.length,
      first_section_id: b.sections[0].id,
      progress: progress(s),
      section_id: s.section_id,
      reading_position: b.sections.findIndex((x) => x.id === s.section_id),
      fraction: s.fraction || 0,
      favorite: !!s.favorite,
      lastOpened: Date.parse(s.updated_at || "") || 0,
    };
  }
  let ready;
  async function initialize() {
    if (!ready)
      ready = (async () => {
        await db();
        if (await get("books", "signal")) return;
        const sample = window.BrowserSample;
        const sections = sample.chapters.map((s, i) => ({
          id: i + 1,
          position: i,
          path: "sample-" + i,
          title: s.title,
          paragraphs: s.paragraphs,
        }));
        const d = await db();
        await new Promise((resolve, reject) => {
          const t = d.transaction("books", "readwrite");
          t.objectStore("books").put({
            id: "signal",
            title: sample.title,
            author: sample.author,
            sections,
            navigation: [],
            cover: "",
            added: Date.now(),
            size: 0,
            sample: true,
          });
          t.oncomplete = resolve;
          t.onerror = () => reject(t.error);
        });
      })();
    return ready;
  }
  async function importFile(file, restore) {
    await initialize();
    const entries = await all();
    if (entries.filter((b) => !b.sample).length >= 100)
      fail("This browser library is limited to 100 imported books.");
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
      ),
      (n) => n.toString(16).padStart(2, "0"),
    ).join("");
    const duplicate = entries.find((b) => b.digest === digest);
    if (duplicate) return { id: duplicate.id, created: false };
    const id = "epub-" + crypto.randomUUID();
    const parsed = await BrowserEPUB.parse(file);
    let size = file.size;
    for (const bytes of parsed.files.values()) size += bytes.length;
    if (entries.reduce((n, b) => n + (b.size || 0), 0) + size > MAX_LIBRARY)
      fail(
        "Local library safety budget is 100 MiB. Export/delete books before importing more.",
      );
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.quota - estimate.usage < size * 1.2)
      fail(
        "Not enough browser storage. Free space or export/delete a local book.",
      );
    const originalBytes = new Uint8Array(await file.arrayBuffer());
    const d = await db();
    await new Promise((resolve, reject) => {
      const t = d.transaction(["books", "files", "state"], "readwrite");
      try {
        t.objectStore("books").put({
          id,
          digest,
          title: parsed.title,
          author: parsed.author,
          sections: parsed.sections,
          navigation: parsed.navigation,
          cover: parsed.cover,
          added: Date.now(),
          size,
        });
        const files = t.objectStore("files");
        const expandedSize = [...parsed.files.values()].reduce(
            (n, b) => n + b.length,
            0,
          ),
          packed = new Uint8Array(expandedSize),
          index = [];
        let offset = 0;
        for (const [path, bytes] of parsed.files) {
          packed.set(bytes, offset);
          index.push([path, offset, bytes.length]);
          offset += bytes.length;
        }
        files.put({ book: id, path: "@expanded", bytes: packed, index });
        if (parsed.cover && parsed.files.has(parsed.cover))
          files.put({
            book: id,
            path: parsed.cover,
            bytes: parsed.files.get(parsed.cover),
          });
        files.put({ book: id, path: "@original", bytes: originalBytes });
        if (restore) {
          const valid = new Set(parsed.sections.map((s) => s.id));
          const p = progress(restore);
          if (!valid.has(p.section_id)) p.section_id = parsed.sections[0].id;
          t.objectStore("state").put({
            id,
            ...p,
            bookmarks: cleanBookmarks(restore.bookmarks, valid),
            inherit: restore.inherit !== false,
          });
        }
        t.oncomplete = resolve;
        t.onabort = t.onerror = (event) =>
          reject(
            Error(
              "Import was not saved (" +
                (event.target?.error?.name ||
                  t.error?.name ||
                  "storage error") +
                "). Browser storage is full or unavailable; no partial book was added.",
            ),
          );
      } catch {
        t.abort();
        reject(
          Error(
            "Import was not saved. Browser storage failed; no partial book was added.",
          ),
        );
      }
    });
    return { id, created: true };
  }
  function cleanBookmarks(items, valid) {
    return (Array.isArray(items) ? items : [])
      .slice(0, 1000)
      .filter((b) => valid.has(b.section_id))
      .map((b, i) => ({
        id: i + 1,
        section_id: b.section_id,
        fraction: Math.max(0, Math.min(1, Number(b.fraction) || 0)),
        anchor: /^text:\d+$/.test(b.anchor || "") ? b.anchor : "",
        title: String(b.title || "Bookmark").slice(0, 300),
      }));
  }
  async function remove(id) {
    if (id === "signal") fail("The included sample stays available.");
    const d = await db();
    await new Promise((resolve, reject) => {
      const t = d.transaction(["books", "files", "state"], "readwrite");
      t.objectStore("books").delete(id);
      t.objectStore("state").delete(id);
      const r = t
        .objectStore("files")
        .openCursor(IDBKeyRange.bound([id, ""], [id, "\uffff"]));
      r.onsuccess = () => {
        const c = r.result;
        if (c) {
          c.delete();
          c.continue();
        }
      };
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    for (const [key, url] of urls)
      if (key.startsWith(id + ":")) {
        URL.revokeObjectURL(url);
        urls.delete(key);
      }
    archives.delete(id);
    for (const prefix of ["webnovelReadingCheckpoint:", "webnovelColumnPages:"])
      localStorage.removeItem(prefix + id);
  }
  function download(blob, name) {
    const a = document.createElement("a"),
      url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name.replace(/[^\w .-]/g, "_").slice(0, 160);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function exportBook(id) {
    const b = await get("books", id),
      s = (await get("state", id)) || {};
    if (b.sample) {
      download(
        new Blob(
          [
            JSON.stringify({
              format: "webnovel-browser-backup-v1",
              sample: true,
              state: s,
            }),
          ],
          { type: "application/json" },
        ),
        "sample-progress.json",
      );
      return;
    }
    const original = await get("files", [id, "@original"]);
    const bytes = new Uint8Array(original.bytes);
    let binary = "";
    for (let p = 0; p < bytes.length; p += 8192)
      binary += String.fromCharCode(...bytes.subarray(p, p + 8192));
    download(
      new Blob(
        [
          JSON.stringify({
            format: "webnovel-browser-backup-v1",
            name: "book.epub",
            epub: btoa(binary),
            state: s,
          }),
        ],
        { type: "application/json" },
      ),
      b.title + "-backup.json",
    );
  }
  async function restoreBackup(file) {
    if (file.size > 30 * 1024 * 1024) fail("Backup exceeds 30 MiB.");
    const data = JSON.parse(await file.text());
    if (data.format !== "webnovel-browser-backup-v1")
      fail("Unrecognized backup.");
    if (data.sample) {
      await initialize();
      return mutate("signal", (s) => {
        Object.assign(s, progress(data.state), {
          bookmarks: cleanBookmarks(data.state?.bookmarks, new Set([1, 2, 3])),
        });
      });
    }
    if (typeof data.epub !== "string" || data.epub.length > 28 * 1024 * 1024)
      fail("Invalid backup EPUB.");
    const bytes = Uint8Array.from(atob(data.epub), (c) => c.charCodeAt(0));
    return importFile(
      new File([bytes], "restored.epub", { type: "application/epub+zip" }),
      data.state,
    );
  }
  async function api(url, options = {}) {
    await initialize();
    const u = new URL(url, location.origin);
    if (u.origin !== location.origin)
      fail("Remote operations are unavailable in Browser Reader Mode.");
    const body =
      options.body instanceof FormData
        ? options.body
        : options.body
          ? JSON.parse(options.body)
          : {};
    if (u.pathname === "/api/books/upload") return importFile(body.get("file"));
    if (u.pathname === "/api/reader/appearance") {
      if (options.method === "PUT")
        return mutate("@appearance", (s) => {
          s.theme = themes.includes(body.theme) ? body.theme : "dark";
          return { theme: s.theme };
        });
      const g = await get("state", "@appearance"),
        s = await get("state", u.searchParams.get("book") || "");
      return { theme: g?.theme || "dark", inherit: s?.inherit !== false };
    }
    if (u.pathname === "/api/books") {
      const query = (u.searchParams.get("q") || "").toLowerCase();
      let books = await Promise.all((await all()).map(describe));
      books = books.filter(
        (b) =>
          (b.title + " " + b.author).toLowerCase().includes(query) &&
          (!u.searchParams.get("favorite") ||
            u.searchParams.get("favorite") === "0" ||
            b.favorite),
      );
      if (u.searchParams.get("kind") === "epub")
        books = books.filter((b) => !b.sample);
      if (u.searchParams.get("sort") === "title")
        books.sort((a, b) => a.title.localeCompare(b.title));
      else if (u.searchParams.get("sort") === "recent")
        books.sort((a, b) => b.lastOpened - a.lastOpened);
      else books.sort((a, b) => (b.added || 0) - (a.added || 0));
      const offset = Math.max(0, +u.searchParams.get("offset") || 0),
        limit = Math.min(100, +u.searchParams.get("limit") || 24);
      return {
        total: books.length,
        items: books.slice(offset, offset + limit),
      };
    }
    const match = u.pathname.match(/^\/api\/books\/([a-z0-9-]+)(?:\/(.*))?$/);
    if (!match) fail("Server-only feature unavailable.");
    const [, id, route = ""] = match,
      b = await get("books", id);
    if (!b) fail("Book not found in this browser.");
    if (!route) return describe(b);
    const selected = (sid) =>
      b.sections.find((s) => s.id === +sid) || fail("Section not found.");
    if (route === "favorite")
      return mutate(id, (s) => {
        s.favorite = body.favorite === true;
        return {};
      });
    if (route === "progress")
      return mutate(id, (s) => {
        if (body.version !== (s.version || 0)) {
          const e = Error(
            "This book changed in another tab. Reload to keep the newer progress.",
          );
          e.status = 409;
          throw e;
        }
        selected(body.section_id);
        Object.assign(s, progress(body), {
          version: (s.version || 0) + 1,
          inherit: body.inherit_theme !== false,
          updated_at: new Date().toISOString().slice(0, -1),
        });
        return { version: s.version };
      });
    if (route === "bookmarks") {
      if (options.method === "POST")
        return mutate(id, (s) => {
          const section = selected(body.section_id);
          s.bookmarks = cleanBookmarks(
            [...(s.bookmarks || []), { ...body, title: section.title }],
            new Set(b.sections.map((s) => s.id)),
          );
          return {};
        });
      if (options.method === "DELETE")
        return mutate(id, (s) => {
          s.bookmarks = (s.bookmarks || []).filter((b) => b.id !== body.id);
          return {};
        });
      return { items: (await get("state", id))?.bookmarks || [] };
    }
    if (route.startsWith("sections/")) {
      const s = selected(route.split("/")[1]);
      let content;
      if (b.sample) {
        const d = document.implementation.createHTMLDocument("");
        for (const [tag, text] of [
          ["h1", s.title],
          ...s.paragraphs.map((p) => ["p", p]),
        ]) {
          const e = d.createElement(tag);
          e.textContent = text;
          d.body.append(e);
        }
        content = d.body.innerHTML;
      } else {
        const f = await fileEntry(id, s.path);
        content = await BrowserEPUB.sanitize(f.bytes, s.path, (p) =>
          image(id, p),
        );
      }
      return {
        ...s,
        content_html: content,
        previous_id: b.sections[s.position - 1]?.id || null,
        next_id: b.sections[s.position + 1]?.id || null,
      };
    }
    if (route === "resolve") {
      const raw = u.searchParams.get("href") || "";
      const [path, anchor = ""] = raw.split("#");
      const s =
        b.sections.find((s) => s.path === path) ||
        fail("This link is outside the readable EPUB.");
      return { id: s.id, anchor };
    }
    if (["sections", "navigation", "search"].includes(route)) {
      let items = route === "navigation" ? b.navigation : b.sections;
      const q = (u.searchParams.get("q") || "").toLowerCase();
      if (route === "search") {
        const generation = ++searchGeneration;
        items = [];
        if (q.length >= 2)
          for (const s of b.sections) {
            if (generation !== searchGeneration) break;
            const text = b.sample
              ? s.paragraphs.join(" ")
              : BrowserEPUB.xml((await fileEntry(id, s.path)).bytes)
                  .documentElement.textContent;
            if ((s.title + " " + text).toLowerCase().includes(q)) items.push(s);
            if (s.position % 20 === 0)
              await new Promise((resolve) => setTimeout(resolve, 0));
          }
      } else if (q)
        items = items.filter((s) => s.title.toLowerCase().includes(q));
      let offset = Math.max(0, +u.searchParams.get("offset") || 0);
      const limit = Math.max(
        1,
        Math.min(100, +u.searchParams.get("limit") || 100),
      );
      if (u.searchParams.has("around"))
        offset = Math.max(
          0,
          items.findIndex((s) => s.id === +u.searchParams.get("around")) - 20,
        );
      return {
        offset,
        total: items.length,
        items: items.slice(offset, offset + limit),
      };
    }
    fail("This server operation is unavailable in Browser Reader Mode.");
  }
  window.addEventListener("pagehide", (event) => {
    // Back/forward-cache documents retain their DOM and must retain image URLs.
    if (event.persisted) return;
    for (const url of urls.values()) URL.revokeObjectURL(url);
  });
  return {
    api,
    importFile,
    remove,
    exportBook,
    restoreBackup,
    originalURL,
    initialize,
    all,
    preferences,
  };
})();
