/* Strict inert EPUB adapter; actual page layout is owned by the reused reader. */
window.BrowserEPUB = (() => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  // DOMParser XML can trigger SVG load handlers before a tree is attached.
  // A quote-aware lexical pass makes active names inert before native parsing;
  // the namespace/tag/attribute allowlist below remains the final boundary.
  function inertXML(text) {
    let result = "",
      position = 0;
    while (position < text.length) {
      const start = text.indexOf("<", position);
      if (start < 0) {
        result += text.slice(position);
        break;
      }
      result += text.slice(position, start);
      const terminator = text.startsWith("<!--", start)
        ? "-->"
        : text.startsWith("<![CDATA[", start)
          ? "]]>"
          : text.startsWith("<?", start)
            ? "?>"
            : null;
      if (terminator) {
        const end = text.indexOf(terminator, start + 2);
        if (end < 0) throw Error("Invalid EPUB XML token.");
        const token = text.slice(start, end + terminator.length);
        if (terminator !== "?>" || /^<\?xml\s/i.test(token)) result += token;
        position = end + terminator.length;
        continue;
      }
      let end = start + 1,
        quote = "";
      for (; end < text.length; end++) {
        const char = text[end];
        if (quote) {
          if (char === quote) quote = "";
        } else if (char === '"' || char === "'") quote = char;
        else if (char === ">") break;
      }
      if (end >= text.length) throw Error("Unclosed EPUB XML tag.");
      let tag = text.slice(start, end + 1);
      tag = tag.replace(/^(<\/?)([^\s/>]+)/, (whole, open, name) => {
        const parts = name.split(":"),
          local = parts.pop();
        return ["script", "style", "svg"].includes(local.toLowerCase())
          ? open +
              (parts.length ? parts.join(":") + ":" : "") +
              "epub-inert-" +
              local.toLowerCase()
          : whole;
      });
      tag = tag.replace(
        /(\s+)([^\s=<>/]+)(\s*=\s*)("[^"]*"|'[^']*')/g,
        (whole, space, name, equal, value) => {
          const local = name.split(":").pop().toLowerCase();
          return local.startsWith("on") ||
            [
              "src",
              "href",
              "srcset",
              "poster",
              "background",
              "data",
              "action",
              "formaction",
              "style",
              "http-equiv",
            ].includes(local)
            ? space + "data-epub-" + local + equal + value
            : whole;
        },
      );
      result += tag;
      position = end + 1;
    }
    return result;
  }
  const xml = (bytes) => {
    let text = typeof bytes === "string" ? bytes : decoder.decode(bytes);
    if (
      text.length > 2 * 1024 * 1024 ||
      /<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)
    )
      throw Error("Unsupported XML declaration or oversized chapter.");
    text = text.replace(/<!DOCTYPE[^>]*>/gi, "");
    const d = new DOMParser().parseFromString(
      inertXML(text),
      "application/xml",
    );
    if (d.querySelector("parsererror")) throw Error("Invalid EPUB XML/XHTML.");
    return d;
  };
  function resolve(base, ref) {
    if (
      typeof ref !== "string" ||
      /[\\\x00-\x1f]/.test(ref) ||
      /^[a-z][\w+.-]*:|^\/\//i.test(ref)
    )
      return null;
    let decoded;
    try {
      decoded = decodeURIComponent(ref);
    } catch {
      return null;
    }
    if (/[\\\x00-\x1f]/.test(decoded) || /^[a-z][\w+.-]*:|^\//i.test(decoded))
      return null;
    const [file, hash = ""] = decoded.split("#");
    if (file.includes("?")) return null;
    const parts = file ? base.split("/").slice(0, -1) : [];
    if (!file) parts.push(...base.split("/"));
    for (const p of file.split("/")) {
      if (!p || p === ".") continue;
      if (p === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else parts.push(p);
    }
    return { path: parts.join("/"), anchor: hash ? anchor(hash) : "" };
  }
  const anchor = (id) =>
    "epub-" +
    String(id)
      .slice(0, 128)
      .replace(/[^\w.-]/g, "_");
  const value = (d, name) =>
    Array.from(d.getElementsByTagName("*"))
      .find((e) => e.localName === name)
      ?.textContent?.trim()
      .slice(0, 500) || "";
  async function extract(file) {
    if (
      !file ||
      file.size > 20 * 1024 * 1024 ||
      !file.size ||
      !/\.epub$/i.test(file.name)
    )
      throw Error("Choose an EPUB file no larger than 20 MiB.");
    const data = await file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const worker = new Worker("/epub-worker.js");
      const timer = setTimeout(() => {
        worker.terminate();
        reject(Error("EPUB extraction timed out."));
      }, 15000);
      const done = () => {
        clearTimeout(timer);
        worker.terminate();
      };
      worker.onmessage = (e) => {
        done();
        e.data.error
          ? reject(Error(e.data.error))
          : resolve(new Map(e.data.files));
      };
      worker.onerror = () => {
        done();
        reject(Error("EPUB extraction failed."));
      };
      worker.postMessage(data, [data]);
    });
  }
  async function parse(file) {
    const files = await extract(file),
      get = (p) => {
        if (!files.has(p)) throw Error("Missing EPUB member.");
        return files.get(p);
      };
    if (decoder.decode(get("mimetype")).trim() !== "application/epub+zip")
      throw Error("This archive is not an EPUB.");
    if (files.has("META-INF/encryption.xml"))
      throw Error("Encrypted/DRM EPUBs are not supported.");
    const container = xml(get("META-INF/container.xml"));
    const root = Array.from(container.getElementsByTagName("*"))
      .find((e) => e.localName === "rootfile")
      ?.getAttribute("full-path");
    if (!root || !files.has(root)) throw Error("Missing EPUB package.");
    const opf = xml(get(root)),
      manifest = new Map();
    for (const e of Array.from(opf.getElementsByTagName("*")))
      if (e.localName === "item") {
        const target = resolve(root, e.getAttribute("data-epub-href"));
        if (target && files.has(target.path))
          manifest.set(e.getAttribute("id"), {
            ...target,
            type: e.getAttribute("media-type"),
            properties: e.getAttribute("properties") || "",
          });
      }
    const sections = [];
    for (const e of Array.from(opf.getElementsByTagName("*")))
      if (e.localName === "itemref" && e.getAttribute("linear") !== "no") {
        const m = manifest.get(e.getAttribute("idref"));
        if (!m || !["application/xhtml+xml", "text/html"].includes(m.type))
          throw Error("Unsupported EPUB reading order.");
        sections.push({
          id: sections.length + 1,
          position: sections.length,
          path: m.path,
          title: `Section ${sections.length + 1}`,
        });
      }
    if (!sections.length || sections.length > 5000)
      throw Error("EPUB must contain 1–5,000 readable sections.");
    // Validate the opening chapter now; parse subsequent sections only on demand.
    xml(get(sections[0].path));
    const nav = [];
    const navFile = [...manifest.values()].find((m) =>
      m.properties.split(/\s+/).includes("nav"),
    );
    if (navFile) {
      const nd = xml(get(navFile.path));
      for (const a of Array.from(nd.getElementsByTagName("*")))
        if (a.localName === "a") {
          const r = resolve(navFile.path, a.getAttribute("data-epub-href"));
          const s = sections.find((s) => s.path === r?.path);
          if (s && nav.length < 10000) {
            s.title = a.textContent.trim().slice(0, 300) || s.title;
            nav.push({
              id: s.id,
              href: r.path + (r.anchor ? "#" + r.anchor : ""),
              title: a.textContent.trim().slice(0, 300),
              depth: 0,
            });
          }
        }
    }
    const ncx = [...manifest.values()].find(
      (m) => m.type === "application/x-dtbncx+xml",
    );
    if (!nav.length && ncx) {
      const nd = xml(get(ncx.path));
      for (const point of Array.from(nd.getElementsByTagName("*")).filter(
        (e) => e.localName === "navPoint",
      )) {
        const content = Array.from(point.children).find(
          (e) => e.localName === "content",
        );
        const label = Array.from(point.children).find(
          (e) => e.localName === "navLabel",
        );
        const r = resolve(ncx.path, content?.getAttribute("data-epub-src"));
        const s = sections.find((s) => s.path === r?.path);
        if (s && nav.length < 10000) {
          s.title = label?.textContent.trim().slice(0, 300) || s.title;
          nav.push({
            id: s.id,
            href: r.path + (r.anchor ? "#" + r.anchor : ""),
            title: s.title,
            depth: 0,
          });
        }
      }
    }
    const coverId = Array.from(opf.getElementsByTagName("*"))
      .find((e) => e.localName === "meta" && e.getAttribute("name") === "cover")
      ?.getAttribute("content");
    const cover =
      [...manifest.values()].find((m) =>
        m.properties.split(/\s+/).includes("cover-image"),
      ) || manifest.get(coverId);
    return {
      title: value(opf, "title") || file.name.replace(/\.epub$/i, ""),
      author: value(opf, "creator") || "Unknown author",
      sections,
      navigation: nav,
      cover: cover?.path || "",
      files,
    };
  }
  function raster(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let w = 0,
      h = 0,
      type = "";
    if (bytes.length > 24 && v.getUint32(0) === 0x89504e47) {
      type = "image/png";
      w = v.getUint32(16);
      h = v.getUint32(20);
    } else if (
      bytes.length > 10 &&
      String.fromCharCode(...bytes.subarray(0, 3)) === "GIF"
    ) {
      type = "image/gif";
      w = v.getUint16(6, true);
      h = v.getUint16(8, true);
    } else if (bytes.length > 4 && v.getUint16(0) === 0xffd8) {
      let at = 2;
      while (at + 9 < bytes.length) {
        if (bytes[at++] !== 255) break;
        const marker = bytes[at++],
          n = v.getUint16(at);
        if (n < 2 || at + n > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
          h = v.getUint16(at + 3);
          w = v.getUint16(at + 5);
          type = "image/jpeg";
          break;
        }
        at += n;
      }
    }
    return w > 0 && h > 0 && w <= 4096 && h <= 4096 && w * h <= 12000000
      ? type
      : null;
  }
  async function sanitize(bytes, path, getImage) {
    const input = xml(bytes),
      body = Array.from(input.getElementsByTagName("*")).find(
        (e) => e.localName === "body",
      );
    if (!body) throw Error("Chapter has no XHTML body.");
    const output = document.implementation.createHTMLDocument(""),
      fragment = output.createElement("div");
    let nodes = 0;
    const allowed = new Set(
      "p div span h1 h2 h3 h4 h5 h6 section article blockquote pre code em strong i b u s small sub sup br hr ul ol li dl dt dd table thead tbody tfoot tr th td caption figure figcaption a img".split(
        " ",
      ),
    );
    const drop = new Set(
      "script style iframe object embed form input button textarea select svg math audio video source link meta base template noscript".split(
        " ",
      ),
    );
    async function copy(node, parent, depth) {
      if (++nodes > 100000 || depth > 100)
        throw Error("EPUB chapter is too complex.");
      if (node.nodeType === 3) {
        parent.append(output.createTextNode(node.textContent));
        return;
      }
      if (
        node.nodeType !== 1 ||
        (node.namespaceURI &&
          !["http://www.w3.org/1999/xhtml"].includes(node.namespaceURI))
      )
        return;
      const tag = node.localName.toLowerCase();
      if (drop.has(tag) || tag.startsWith("epub-inert-")) return;
      const el = allowed.has(tag) ? output.createElement(tag) : parent;
      if (el !== parent) {
        if (node.hasAttribute("id")) el.id = anchor(node.getAttribute("id"));
        if (node.hasAttribute("lang"))
          el.lang = node.getAttribute("lang").slice(0, 20);
        if (tag === "a") {
          const r = resolve(path, node.getAttribute("data-epub-href"));
          if (r) {
            el.dataset.bookTarget = r.path + (r.anchor ? "#" + r.anchor : "");
            el.setAttribute("href", "#");
          }
        }
        if (tag === "img") {
          const r = resolve(path, node.getAttribute("data-epub-src"));
          const url = r && (await getImage(r.path));
          if (!url) return;
          el.src = url;
          el.alt = (node.getAttribute("alt") || "Book illustration").slice(
            0,
            200,
          );
        }
        parent.append(el);
      }
      for (const child of node.childNodes) await copy(child, el, depth + 1);
    }
    for (const child of body.childNodes) await copy(child, fragment, 0);
    return fragment.innerHTML;
  }
  return { parse, sanitize, resolve, raster, anchor, xml };
})();
