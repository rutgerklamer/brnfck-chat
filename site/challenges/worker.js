// Runs the reader's program away from the page, so the page never freezes.
importScripts('engine.js?v=r6');
self.onmessage = function (e) {
  const job = e.data;
  for (let i = 0; i < job.cases.length; i++) {
    const c = job.cases[i];
    let r;
    try { r = BFEngine.run(job.code, c); } catch (err) { r = { status: 'crash', out: '', steps: 0, why: String(err && err.message || err) }; }
    self.postMessage({ id: job.id, i: i, status: r.status, why: r.why || '', out: r.out, steps: r.steps });
    if (r.status === 'brackets') break;
  }
  self.postMessage({ id: job.id, done: true });
};
