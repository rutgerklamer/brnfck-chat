// Finds a program for a page: its chunks or its file, and its meta file.
(function (root) {
  'use strict';
  const PS = root.ProgramSource;
  const size = (n) => (n < 1e9 ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(2)} GB`);
  const abs = (u) => new URL(u, location.href).href;

  async function json(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    return res.json();
  }

  async function find(o) {
    const P = { name: o.name, mode: 'file', meta: null, manifest: null, manifestUrl: o.manifestUrl ? abs(o.manifestUrl) : null, fileUrl: abs(o.fileUrl), store: true, stored: { chunks: 0, bytes: 0 } };
    // program-hosts.json may name another host for the chunks of this program
    try {
      const hosts = await json(abs(o.hostsUrl || '../program-hosts.json')), where = hosts && hosts[o.name];
      if (typeof where === 'string' && where) P.manifestUrl = new URL('manifest.json', new URL(where.endsWith('/') ? where : where + '/', location.href)).href;
    } catch (e) { }
    // no manifestUrl: the program has no chunks, only its file (the training programs)
    P.manifest = P.manifestUrl ? await PS.manifest(P.manifestUrl) : null;
    if (P.manifest) {
      P.mode = 'chunks';
      try { P.meta = await json(new URL(P.manifest.meta || 'meta.json', P.manifestUrl).href); }
      catch (e) { const err = new Error(`Found the chunks of the program, but could not load their meta file (${e.message}).`); err.stage = 'meta'; throw err; }
      P.stored = await PS.stored(P.manifest, P.manifestUrl);
    } else {
      try { P.meta = await json(abs(o.metaUrl)); }
      catch (e) { const err = new Error(`This host has no copy of the program: neither chunks (${o.manifestUrl}) nor the program file's meta file (${o.metaUrl}: ${e.message}).`); err.stage = 'meta'; throw err; }
    }
    P.downloadBytes = P.mode === 'chunks' ? Math.max(0, P.manifest.compressedBytes - P.stored.bytes) : P.meta.programBytes;
    P.loadMessage = () => ({ meta: P.meta, manifest: P.manifest, manifestUrl: P.manifestUrl, fileUrl: P.fileUrl, store: P.store });
    return P;
  }

  // { kind: 'phone' | 'memory' } when this device most likely cannot run a program that needs `needGB`
  function device(needGB) {
    const ua = navigator.userAgent || '';
    const phone = (navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (phone) return { kind: 'phone' };
    const dm = navigator.deviceMemory;
    if (dm !== undefined && dm < needGB * 1.3) return { kind: 'memory' };
    return null;
  }

  function follow(box) {
    let stick = true;
    box.addEventListener('scroll', () => { stick = box.scrollHeight - box.scrollTop - box.clientHeight < 32; }, { passive: true });
    new MutationObserver(() => { if (stick && box.scrollHeight > box.clientHeight) box.scrollTop = box.scrollHeight; }).observe(box, { childList: true, characterData: true, subtree: true });
  }

  root.ProgramStart = { find, size, device, follow };
})(self);
