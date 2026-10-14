// "Download this program (.bf)" for any page of the site.
(function (root) {
  'use strict';
  const PS = root.ProgramSource, size = root.ProgramStart.size;
  const num = (n) => Math.round(n).toLocaleString('en-US');

  // ---- SHA-256 of a stream (crypto.subtle only takes everything at once) ----
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256() {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Int32Array(64), block = new Uint8Array(64);
    let fill = 0, total = 0, done = null;
    function compress(b, o) {
      for (let i = 0; i < 16; i++, o += 4) W[i] = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
      for (let i = 16; i < 64; i++) {
        const x = W[i - 15], y = W[i - 2];
        W[i] = (W[i - 16] + ((x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ (x >>> 3)) + W[i - 7] + ((y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ (y >>> 10))) | 0;
      }
      let a = H[0] | 0, bb = H[1] | 0, c = H[2] | 0, d = H[3] | 0, e = H[4] | 0, f = H[5] | 0, g = H[6] | 0, h = H[7] | 0;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    function update(bytes) {
      let i = 0;
      const n = bytes.length;
      total += n;
      if (fill) {
        const take = Math.min(64 - fill, n);
        block.set(bytes.subarray(0, take), fill); fill += take; i = take;
        if (fill < 64) return;
        compress(block, 0); fill = 0;
      }
      for (; i + 64 <= n; i += 64) compress(bytes, i);
      if (i < n) { block.set(bytes.subarray(i), 0); fill = n - i; }
    }
    function hex() {
      if (done) return done;
      const bits = total * 8, pad = new Uint8Array((fill < 56 ? 56 : 120) - fill + 8);
      pad[0] = 0x80;
      const hi = Math.floor(bits / 2 ** 32), lo = bits >>> 0, p = pad.length - 8;
      pad[p] = hi >>> 24; pad[p + 1] = hi >>> 16; pad[p + 2] = hi >>> 8; pad[p + 3] = hi; pad[p + 4] = lo >>> 24; pad[p + 5] = lo >>> 16; pad[p + 6] = lo >>> 8; pad[p + 7] = lo;
      update(pad);
      done = '';
      for (let i = 0; i < 8; i++) done += (H[i] >>> 0).toString(16).padStart(8, '0');
      return done;
    }
    return { update, hex };
  }

  // ---- chunks -> one writable, in order, checked ----
  async function save(m, manifestUrl, writable, o) {
    o = o || {};
    // 'read': use the chunks this browser already keeps, but do not keep more
    const src = await PS.open({ manifest: m, manifestUrl, store: 'read' });
    const sum = sha256();
    const stop = () => src.cancel();
    if (o.signal) { if (o.signal.aborted) throw new DOMException('stopped', 'AbortError'); o.signal.addEventListener('abort', stop); }
    let told = 0;
    try {
      for (;;) {
        const { done, value } = await src.read();
        if (o.signal && o.signal.aborted) throw new DOMException('stopped', 'AbortError');
        if (done) break;
        sum.update(value);
        await writable.write(value);
        const t = Date.now();
        if (o.onProgress && t - told > 150) { told = t; o.onProgress({ bytes: src.rawBytes, total: m.totalBytes, net: src.netBytes, stored: src.storedBytes }); }
      }
    } finally { if (o.signal) o.signal.removeEventListener('abort', stop); }
    if (src.rawBytes !== m.totalBytes) throw new Error(`got ${num(src.rawBytes)} of ${num(m.totalBytes)} characters: the download broke off`);
    await writable.close();
    if (o.onProgress) o.onProgress({ bytes: src.rawBytes, total: m.totalBytes, net: src.netBytes, stored: src.storedBytes });
    const hex = sum.hex();
    return { bytes: src.rawBytes, sha256: hex, equal: hex === m.sha256, checked: src.checked };
  }

  // ---- for browsers without a save picker: one command per operating system ----
  function commands(m, manifestUrl) {
    const base = new URL(m.base || '.', manifestUrl).href, last = m.chunks.length - 1, file = m.program;
    return {
      linux: `for i in $(seq 0 ${last}); do curl -fsSL "${base}$(printf '%03d/%06d' $((i/1000)) $i).gz" | gunzip || break; done > ${file} && sha256sum ${file}`,
      mac: `for i in $(seq 0 ${last}); do curl -fsSL "${base}$(printf '%03d/%06d' $((i/1000)) $i).gz" | gunzip || break; done > ${file} && shasum -a 256 ${file}`,
      windows: `$o=[IO.File]::Create("$PWD\\${file}"); $w=New-Object Net.WebClient; 0..${last} | % { $s=$w.OpenRead(("${base}{0:d3}/{1:d6}.gz" -f [int][math]::Floor($_/1000),$_)); $g=New-Object IO.Compression.GZipStream($s,[IO.Compression.CompressionMode]::Decompress); $g.CopyTo($o); $g.Close() }; $o.Close(); (Get-FileHash ${file} -Algorithm SHA256).Hash.ToLower()`,
    };
  }

  // ---- the control ----
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function attach(box, P) {
    const meta = P.meta, m = P.manifest, name = meta.program;
    box.textContent = '';
    box.classList.add('program-download');
    const head = el('p', 'pd-head');
    head.append(el('b', '', 'Download this program (.bf)'), document.createTextNode(` ${name}: ${num(meta.programBytes)} characters (${size(meta.programBytes)}), one very long line of the eight commands.`));
    const sum = el('p', 'pd-sum small');
    sum.append(document.createTextNode('SHA-256 of the file, to check your copy: '), el('code', '', meta.sha256));
    const act = el('div', 'pd-act'), status = el('p', 'pd-status small'), more = el('div', 'pd-more');
    status.setAttribute('role', 'status');
    box.append(head, sum, act, status, more);

    const exists = (url) => fetch(url, { method: 'HEAD' }).then((r) => r.ok, () => false);
    Promise.all([exists(P.fileUrl), m && m.single ? exists(new URL(m.single.file, new URL(m.base || '.', P.manifestUrl)).href) : false]).then(([there, singleThere]) => {
      if (there) {
        // 1. the file itself is on this host (your own computer)
        const a = el('a', 'pd-link', `Download ${name} (${size(meta.programBytes)})`);
        a.href = P.fileUrl; a.download = name;
        act.append(a);
        status.textContent = 'The file comes from the server this page came from, as it is: nothing is unpacked.';
        return;
      }
      if (!m) { status.textContent = 'This host has no copy of the program. The README of the project says how to build it.'; return; }
      const picker = typeof root.showSaveFilePicker === 'function';
      // 2a. chunks -> straight to a file on disk
      if (picker) {
        const go = el('button', '', `Save ${name} (${size(m.totalBytes)})`), cancel = el('button', 'quiet', 'Cancel');
        go.type = cancel.type = 'button'; cancel.style.display = 'none';
        act.append(go, cancel);
        status.textContent = `It downloads ${size(m.compressedBytes)} of compressed pieces and writes ${size(m.totalBytes)} to the place you choose: check that the disk has that much room. Nothing is held in memory.`;
        let ctl = null;
        cancel.addEventListener('click', () => { if (ctl) ctl.abort(); });
        go.addEventListener('click', async () => {
          let handle, writable = null;
          try { handle = await root.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Brainfuck program', accept: { 'text/plain': ['.bf'] } }] }); }
          catch (e) { return; }                                 // the visitor closed the picker
          go.disabled = true; cancel.style.display = '';
          ctl = new AbortController();
          const t0 = Date.now();
          try {
            writable = await handle.createWritable();
            const r = await save(m, P.manifestUrl, writable, {
              signal: ctl.signal,
              onProgress: (p) => { status.textContent = `${num(p.bytes / 1e6)} of ${num(p.total / 1e6)} million characters written  ·  ${size(p.net)} downloaded${p.stored ? `, ${size(p.stored)} from the copy stored in this browser` : ''}  ·  ${Math.round((Date.now() - t0) / 1000)} s`; },
            });
            status.textContent = r.equal
              ? `Saved: ${num(r.bytes)} characters in ${Math.round((Date.now() - t0) / 1000)} s. The SHA-256 of what was written is ${r.sha256}: equal to the one above. All ${num(r.checked)} pieces were equal to their checksums.`
              : `Saved ${num(r.bytes)} characters, but the SHA-256 of what was written is ${r.sha256}, NOT the one above: do not trust this file. Try again.`;
          } catch (e) {
            if (writable) { try { await writable.abort(); } catch (e2) { } }
            status.textContent = e && e.name === 'AbortError' ? 'Cancelled: nothing was saved.' : `The download failed: ${(e && e.message) || e}. Nothing was saved.`;
          }
          ctl = null; go.disabled = false; cancel.style.display = 'none';
        });
      }
      // 2b. every browser: one compressed file (when the host has it), and the commands
      const base = new URL(m.base || '.', P.manifestUrl);
      if (m.single && singleThere) {
        const p = el('p', 'small'), a = el('a', 'pd-link', `${m.single.file} (${size(m.single.bytes)})`);
        a.href = new URL(m.single.file, base).href; a.download = m.single.file;
        p.append(document.createTextNode(picker ? 'Or the program as one compressed file: ' : 'The program as one compressed file: '), a,
          document.createTextNode(`. Unpack it to get the ${size(m.totalBytes)} .bf file: `), el('code', '', `gunzip ${m.single.file}`),
          document.createTextNode(' on Linux and macOS; on Windows a program such as 7-Zip, or the command below instead. SHA-256 of the compressed file: '), el('code', '', m.single.sha256), document.createTextNode('.'));
        more.append(p);
      }
      const d = el('details', 'pd-cmd'), s = el('summary', '', picker ? 'Or with one command, without this page' : 'With one command (Firefox and Safari cannot write a download straight to a file)');
      const c = commands(m, P.manifestUrl);
      d.append(s, el('p', 'small', `Each command fetches the ${num(m.chunks.length)} compressed pieces in order (${size(m.compressedBytes)}), unpacks them into ${name} in the current folder (${size(m.totalBytes)}) and prints the file's SHA-256, which must be the one above. Chrome, Edge and other desktop Chromium browsers get a Save button instead; Firefox and Safari get ${m.single && singleThere ? 'the compressed file and ' : ''}these commands.`));
      for (const [label, text] of [['Linux (bash)', c.linux], ['macOS (zsh or bash)', c.mac], ['Windows (PowerShell)', c.windows]]) {
        const pre = el('pre', 'cmd listing', text);
        pre.tabIndex = 0; pre.setAttribute('aria-label', `Command for ${label}`);
        const copy = el('button', 'link', 'copy');
        copy.type = 'button';
        copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); copy.textContent = 'copied'; } catch (e) { copy.textContent = 'select the text and copy it'; } });
        const h = el('p', 'small', label + '  ');
        h.append(copy);
        d.append(h, pre);
      }
      more.append(d);
      if (!picker && !(m.single && singleThere)) d.open = true;
      if (!picker) status.textContent = `This browser cannot write a download of ${size(m.totalBytes)} straight to a file (it has no save picker; desktop Chrome and Edge do). ${m.single && singleThere ? 'Take the compressed file below, or use a command.' : 'Use one of the commands below.'}`;
    });
  }

  root.ProgramDownload = { attach };
})(self);
