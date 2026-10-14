// Where a page or a worker gets a program's text from: compressed chunks, or the one big file.
(function (root) {
  'use strict';

  const AHEAD = 4;                                   // chunks downloaded at the same time, ahead of the one being run
  const hasStore = () => typeof caches !== 'undefined' && caches && typeof caches.open === 'function';
  const cacheName = (m) => `bf-program:${m.name}:${m.sha256.slice(0, 16)}`;
  const chunkUrl = (m, manifestUrl, i) => new URL(m.chunks[i].file, new URL(m.base || '.', manifestUrl)).href;
  const rawLength = (m, i) => Math.min(m.chunkBytes, m.totalBytes - i * m.chunkBytes);

  async function sha256(bytes) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    let hex = '';
    for (let i = 0; i < d.length; i++) hex += (d[i] < 16 ? '0' : '') + d[i].toString(16);
    return hex;
  }

  // The manifest at `url`, or null when there is none (the big file is used then).
  async function manifest(url) {
    let res;
    try { res = await fetch(url, { cache: 'no-cache' }); } catch (e) { return null; }
    if (!res.ok) return null;
    let m;
    try { m = await res.json(); } catch (e) { return null; }
    if (!m || m.format !== 'bf-chunks-1' || m.compression !== 'gzip' || !Array.isArray(m.chunks)) throw new Error(`${url} is not a manifest this page understands (format ${m && m.format})`);
    if (m.chunks.length !== Math.ceil(m.totalBytes / m.chunkBytes)) throw new Error(`${url}: the number of chunks does not fit the length of the program`);
    return m;
  }

  // Older copies of the same program (another build) are of no use: remove them.
  async function openStore(m) {
    if (!hasStore()) return null;
    try {
      const mine = cacheName(m), prefix = `bf-program:${m.name}:`;
      for (const k of await caches.keys()) if (k.startsWith(prefix) && k !== mine) await caches.delete(k);
      return await caches.open(mine);
    } catch (e) { return null; }
  }

  async function stored(m, manifestUrl) {
    const out = { chunks: 0, bytes: 0 };
    if (!hasStore()) return out;
    try {
      if (!(await caches.has(cacheName(m)))) return out;
      const cache = await caches.open(cacheName(m)), have = new Set((await cache.keys()).map((r) => r.url));
      m.chunks.forEach((c, i) => { if (have.has(chunkUrl(m, manifestUrl, i))) { out.chunks++; out.bytes += c.bytes; } });
    } catch (e) { }
    return out;
  }

  async function remove(m) {
    if (!hasStore()) return false;
    let any = false;
    const prefix = `bf-program:${m.name}:`;
    for (const k of await caches.keys()) if (k.startsWith(prefix)) any = (await caches.delete(k)) || any;
    return any;
  }

  // One chunk's compressed bytes, checked. From the stored copy when it is there and sound.
  async function getChunk(st, i) {
    const m = st.m, c = m.chunks[i], url = chunkUrl(m, st.manifestUrl, i);
    const sound = async (buf) => buf.byteLength === c.bytes && (await sha256(buf)) === c.sha256;
    if (st.cache) {
      try {
        const hit = await st.cache.match(url);
        if (hit) {
          const buf = await hit.arrayBuffer();
          if (await sound(buf)) return { buf, from: 'store' };
          await st.cache.delete(url);
        }
      } catch (e) { }
    }
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000 * attempt));
      if (st.cancelled) throw new Error('stopped');
      try {
        const res = await fetch(url, attempt ? { cache: 'reload' } : undefined);
        if (res.status === 429) {
          const t = /t=(\d+)/.exec(res.headers.get('RateLimit') || ''), wait = Math.min(300, t ? Number(t[1]) + 1 : Number(res.headers.get('Retry-After')) || 60);
          await new Promise((r) => setTimeout(r, wait * 1000));
          last = new Error(`could not download ${url}: the host answered "too many requests" (429) three times. Wait a few minutes and reload.`);
          continue;
        }
        if (!res.ok) { last = new Error(`could not download ${url}: the server answered ${res.status}`); if (res.status === 404) break; continue; }
        const buf = await res.arrayBuffer();
        if (await sound(buf)) {
          if (st.cache && st.storing) {
            try { await st.cache.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength) } })); }
            catch (e) { st.storing = false; }               // no room, or not allowed: go on without keeping
          }
          return { buf, from: 'net' };
        }
        const b = new Uint8Array(buf);
        if (buf.byteLength === rawLength(m, i) && !(b[0] === 0x1f && b[1] === 0x8b) && (await sha256(buf)) === c.rawSha256) return { buf, from: 'net', plain: true };
        last = new Error(`${url} is not the file the manifest describes (${buf.byteLength} bytes, expected ${c.bytes}; checksum differs)`);
      } catch (e) { last = new Error(`could not download ${url} (${(e && e.message) || e})`); }
    }
    throw last;
  }

  function openChunks(o) {
    const m = o.manifest;
    const st = { m, manifestUrl: o.manifestUrl, cache: null, storing: o.store !== false && o.store !== 'read', useStore: o.store !== false, cancelled: false };
    const src = { source: 'chunks', rawBytes: 0, netBytes: 0, storedBytes: 0, checked: 0, get storing() { return !!st.cache && st.storing; } };
    const from = Math.floor((o.from || 0) / m.chunkBytes), to = o.to === undefined ? m.chunks.length : Math.ceil(o.to / m.chunkBytes);
    const pending = new Map();
    let ready = null, next = from, current = null, wanted = from;
    const want = (i) => { if (i < to && !pending.has(i)) { const p = getChunk(st, i); p.catch(() => {}); pending.set(i, p); } };
    async function nextChunk() {
      if (next >= to) return false;
      const i = next++;
      for (; wanted < Math.min(to, i + AHEAD); wanted++) want(wanted);
      want(i);
      const got = await pending.get(i);
      pending.delete(i);
      if (got.from === 'store') src.storedBytes += got.buf.byteLength; else src.netBytes += got.buf.byteLength;
      src.checked++;
      const expect = rawLength(m, i);
      if (got.plain) current = { plain: new Uint8Array(got.buf), left: expect, index: i };
      else current = { reader: new Blob([got.buf]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(), left: expect, index: i };
      return true;
    }
    src.read = async () => {
      if (!ready) ready = (async () => { st.cache = st.useStore ? await openStore(m) : null; })();
      await ready;
      for (;;) {
        if (st.cancelled) return { done: true, value: undefined };
        if (!current && !(await nextChunk())) return { done: true, value: undefined };
        if (current.plain) { const value = current.plain; current = null; src.rawBytes += value.length; return { done: false, value }; }
        let r;
        try { r = await current.reader.read(); } catch (e) { throw new Error(`chunk ${m.chunks[current.index].file} could not be decompressed (${(e && e.message) || e})`); }
        if (r.done) {
          if (current.left !== 0) throw new Error(`chunk ${m.chunks[current.index].file} gave ${current.left} characters too few`);
          current = null;
          continue;
        }
        current.left -= r.value.length;
        if (current.left < 0) throw new Error(`chunk ${m.chunks[current.index].file} gave too many characters`);
        src.rawBytes += r.value.length;
        return { done: false, value: r.value };
      }
    };
    src.cancel = () => { st.cancelled = true; if (current && current.reader) current.reader.cancel().catch(() => {}); };
    return src;
  }

  async function openFile(o) {
    let res;
    try { res = await fetch(o.fileUrl, o.fetchOptions); } catch (e) { throw new Error(`could not download ${o.fileUrl} (${(e && e.message) || e})`); }
    if (!res.ok) throw new Error(`could not download ${o.fileUrl}: the server answered ${res.status}`);
    const reader = res.body.getReader();
    const src = { source: 'file', rawBytes: 0, netBytes: 0, storedBytes: 0, checked: 0, storing: false };
    src.read = async () => {
      const r = await reader.read();
      if (!r.done) { src.rawBytes += r.value.length; src.netBytes += r.value.length; }
      return r;
    };
    src.cancel = () => { reader.cancel().catch(() => {}); };
    return src;
  }

  async function open(o) {
    if (o.manifest) {
      if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot decompress a download by itself (DecompressionStream is missing): a current version of Chrome, Edge, Firefox or Safari is needed');
      return openChunks(o);
    }
    return openFile(o);
  }

  // The characters [from, from + length) of the program, from the chunks that hold them.
  async function slice(m, manifestUrl, from, length) {
    const end = Math.min(m.totalBytes, from + length), out = new Uint8Array(Math.max(0, end - from));
    if (!out.length) return out;
    const first = Math.floor(from / m.chunkBytes) * m.chunkBytes;
    const src = openChunks({ manifest: m, manifestUrl, store: false, from, to: end });
    let at = first;
    for (;;) {
      const { done, value } = await src.read();
      if (done) break;
      const a = Math.max(from, at), b = Math.min(end, at + value.length);
      if (b > a) out.set(value.subarray(a - at, b - at), a - from);
      at += value.length;
      if (at >= end) { src.cancel(); break; }
    }
    return out;
  }

  root.ProgramSource = { open, manifest, stored, remove, slice };
})(self);
