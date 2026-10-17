/* ZIP extraction only. Never fetch book references or execute publication code. */
importScripts("/vendor/fflate.js");
const LIMIT = 64 * 1024 * 1024,
  ENTRY = 8 * 1024 * 1024;
function inspect(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (
      v.getUint32(p, true) === 0x06054b50 &&
      p + 22 + v.getUint16(p + 20, true) === bytes.length
    ) {
      end = p;
      break;
    }
  if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true))
    throw Error("Invalid or multipart EPUB archive.");
  const count = v.getUint16(end + 10, true),
    size = v.getUint32(end + 12, true),
    start = v.getUint32(end + 16, true);
  if (
    !count ||
    count > 10000 ||
    count !== v.getUint16(end + 8, true) ||
    start + size !== end
  )
    throw Error("Unsupported or oversized ZIP directory.");
  const entries = new Map();
  let p = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50)
      throw Error("Invalid ZIP entry.");
    const flags = v.getUint16(p + 8, true),
      method = v.getUint16(p + 10, true),
      crc = v.getUint32(p + 16, true),
      packed = v.getUint32(p + 20, true),
      unpacked = v.getUint32(p + 24, true),
      n = v.getUint16(p + 28, true),
      x = v.getUint16(p + 30, true),
      c = v.getUint16(p + 32, true),
      local = v.getUint32(p + 42, true);
    if (p + 46 + n + x + c > end) throw Error("Invalid ZIP directory bounds.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(p + 46, p + 46 + n),
    );
    if (
      !name ||
      name.length > 512 ||
      /[\\\x00-\x1f:]/.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((s) => s === ".." || s === ".") ||
      entries.has(name) ||
      ((v.getUint32(p + 38, true) >>> 16) & 0xf000) === 0xa000
    )
      throw Error("Unsafe or duplicate EPUB path.");
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      packed === 0xffffffff ||
      unpacked > ENTRY ||
      local + 30 > start ||
      v.getUint32(local, true) !== 0x04034b50
    )
      throw Error("Encrypted or oversized EPUB entry.");
    const ln = v.getUint16(local + 26, true),
      lx = v.getUint16(local + 28, true);
    const localName = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(local + 30, local + 30 + ln),
    );
    if (localName !== name || local + 30 + ln + lx + packed > start)
      throw Error("Inconsistent EPUB directory.");
    total += unpacked;
    if (total > LIMIT)
      throw Error("EPUB expands beyond the 64 MiB safety limit.");
    entries.set(name, { size: unpacked, crc });
    p += 46 + n + x + c;
  }
  if (p !== end) throw Error("Invalid ZIP directory length.");
  return entries;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
self.onmessage = ({ data }) => {
  try {
    const bytes = new Uint8Array(data),
      expected = inspect(bytes),
      files = [],
      seen = new Set();
    let total = 0;
    const unzip = new fflate.Unzip((file) => {
      const meta = expected.get(file.name);
      if (!meta || seen.has(file.name)) throw Error("Unexpected ZIP member.");
      seen.add(file.name);
      let size = 0,
        crc = 0xffffffff;
      const chunks = [];
      file.ondata = (err, chunk, final) => {
        if (err) throw err;
        size += chunk.length;
        total += chunk.length;
        if (size > meta.size || size > ENTRY || total > LIMIT) {
          file.terminate();
          throw Error("ZIP expansion exceeds declared bounds.");
        }
        for (const b of chunk) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
        chunks.push(chunk);
        if (final) {
          if (size !== meta.size || (crc ^ 0xffffffff) >>> 0 !== meta.crc)
            throw Error("Corrupt EPUB member.");
          const out = new Uint8Array(size);
          let at = 0;
          for (const c of chunks) {
            out.set(c, at);
            at += c.length;
          }
          files.push([file.name, out]);
        }
      };
      file.start();
    });
    unzip.register(fflate.UnzipInflate);
    for (let p = 0; p < bytes.length; p += 8192)
      unzip.push(bytes.subarray(p, p + 8192), p + 8192 >= bytes.length);
    if (seen.size !== expected.size || files.length !== seen.size)
      throw Error("Incomplete EPUB archive.");
    self.postMessage(
      { files },
      files.map(([, b]) => b.buffer),
    );
  } catch (e) {
    self.postMessage({ error: e.message || "Invalid EPUB archive." });
  }
};
