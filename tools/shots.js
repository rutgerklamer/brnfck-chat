#!/usr/bin/env node
// The pictures of the figures that the start page and the README show (site/show/): each one taken from the page
// itself, in headless Chrome, after its figure has drawn, cropped to the figure.
//   node tools/shots.js [name...]        (the site must be served on http://localhost:8840, with the data of README step 5)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SITE = process.env.SITE || 'http://localhost:8840';
const OUT = path.join(__dirname, '..', 'site', 'show');
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));

// name: the page, the size of the window, what to do once it is there (in the page), and what to crop to: the box
// around the elements of a selector, or (map) around what is drawn on the canvas, the dark sheet left out
const MAPBOX = `(() => {
  const c = document.getElementById('m-canvas'), g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, bg = g.slice(0, 3);
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) { const i = 4 * (y * c.width + x); if (Math.abs(g[i] - bg[0]) + Math.abs(g[i + 1] - bg[1]) + Math.abs(g[i + 2] - bg[2]) > 30) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  const r = c.getBoundingClientRect(), k = r.width / c.width, m = 24;
  return { x: r.left + scrollX + x0 * k - m, y: r.top + scrollY + y0 * k - m, width: (x1 - x0) * k + 2 * m, height: (y1 - y0) * k + 2 * m };
})()`;
const HIDE_MAP = `document.getElementById('m-panel-toggle').click(); document.head.insertAdjacentHTML('beforeend', '<style>.mapctl, #m-mini { display: none !important; }</style>')`;
const SHOTS = {
  map: { url: '/map/?m=0.8b-vision', w: 1300, h: 1100, wait: 9000, prep: HIDE_MAP, box: MAPBOX },
  picture: { url: '/vision/', w: 1300, h: 900, wait: 6000, prep: `document.getElementById('fig-look').scrollIntoView()`, clip: '#look-view' },
  layers: { url: '/how/', w: 1300, h: 900, wait: 6000, prep: `document.querySelector('#lens-prog [data-m="1.5b"]').click(); document.getElementById('fig-lens').scrollIntoView()`, clip: '#lens-grid' },
  scale: { url: '/compare/', w: 1300, h: 900, wait: 6000, prep: `document.getElementById('fig-eight').scrollIntoView()`, clip: '#fig-eight .sc-rows' },
  // the child of the Shakespeare run on "Now is the winter of our disconte": where it looks, and its guesses
  shakespeare: { url: '/train/', w: 1100, h: 900, wait: 7000, prep: `document.getElementById('sh-att-pick').parentElement.style.display = 'none'; document.getElementById('fig-sh-att').scrollIntoView()`, clip: '#sh-att-text, #sh-att-row, #sh-att-next' },
  // the program brnfck-qwen2.5-coder-0.5b wrote for the challenge Even or odd, coloured by command
  coder: { url: '/coder/', w: 1000, h: 900, wait: 5000, prep: `(() => { const s = document.getElementById('ask-task'); s.value = [...s.options].find((o) => /Even or odd/.test(o.textContent)).value; s.dispatchEvent(new Event('change')); document.getElementById('fig-ask').scrollIntoView(); })()`, clip: '#ask-q, #ask-code' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!CHROME) throw new Error('no Chrome found: set CHROME');
  fs.mkdirSync(OUT, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 500), prof = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let tabs = null;
    for (let i = 0; i < 50 && !tabs; i++) { await sleep(200); tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null); }
    const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const wait = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
    const cdp = (method, params = {}) => new Promise((res, rej) => { const k = ++id; wait.set(k, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: k, method, params })); });
    const js = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
    await cdp('Page.enable');
    for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS)) {
      const s = SHOTS[name];
      await cdp('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: false });
      await cdp('Page.navigate', { url: SITE + s.url });
      await sleep(s.wait);
      if (s.prep) { await js(s.prep); await sleep(2500); }
      const box = await js(s.box || `(() => { const ns = [...document.querySelectorAll(${JSON.stringify(s.clip)})].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0); if (!ns.length) return null;
        const x0 = Math.min(...ns.map((r) => r.left)), y0 = Math.min(...ns.map((r) => r.top)), x1 = Math.max(...ns.map((r) => r.right)), y1 = Math.max(...ns.map((r) => r.bottom));
        return { x: x0 + scrollX, y: y0 + scrollY, width: x1 - x0, height: y1 - y0 }; })()`);
      if (!box) throw new Error(name + ': nothing matches ' + s.clip);
      const shot = await cdp('Page.captureScreenshot', { format: 'webp', quality: 86, clip: { ...box, scale: 1 }, captureBeyondViewport: true });
      fs.writeFileSync(path.join(OUT, name + '.webp'), Buffer.from(shot.data, 'base64'));
      console.log(`${name}: ${Math.round(box.width)} x ${Math.round(box.height)} (x2) from ${s.url}`);
    }
    ws.close();
  } finally { chrome.kill(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
