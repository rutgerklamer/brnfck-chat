'use strict';

// Builds brainfuck from named tape addresses, tracking where the pointer is.
class Emitter {
  constructor() {
    this.code = [];
    this.ptr = 0;
  }

  // ---- primitives ---------------------------------------------------------

  to(addr) {
    const d = addr - this.ptr;
    this.code.push((d > 0 ? '>' : '<').repeat(Math.abs(d)));
    this.ptr = addr;
    return this;
  }

  add(addr, n) {
    this.to(addr);
    this.code.push((n > 0 ? '+' : '-').repeat(Math.abs(n)));
    return this;
  }

  clear(addr) {
    this.to(addr);
    this.code.push('[-]');
    return this;
  }

  loop(addr, body) {
    this.to(addr);
    this.code.push('[');
    body();
    this.to(addr);
    this.code.push(']');
    return this;
  }

  out(addr) {
    this.to(addr);
    this.code.push('.');
    return this;
  }

  read(addr) {
    this.to(addr);
    this.code.push(',');
    return this;
  }

  // ---- arithmetic patterns ------------------------------------------------

  // Every target addr += f * src; src ends 0.
  scatter(src, targets) {
    const live = targets.filter(([, f]) => f !== 0).sort((a, b) => a[0] - b[0]);
    if (!live.length) return this.clear(src);
    return this.loop(src, () => {
      this.add(src, -1);
      for (const [addr, f] of live) this.add(addr, f);
    });
  }

  // Pattern "move": dst += src, src = 0.
  move(src, dst) {
    return this.scatter(src, [[dst, 1]]);
  }

  copy(src, dst, tmp) {
    return this.scatter(src, [[dst, 1], [tmp, 1]]).move(tmp, src);
  }

  addConst(addr, n, tmp) {
    const size = Math.abs(n);
    if (size < 24) return this.add(addr, n);
    const a = Math.round(Math.sqrt(size));
    const b = Math.floor(size / a);
    this.add(tmp, a);
    this.scatter(tmp, [[addr, Math.sign(n) * b]]);
    return this.add(addr, Math.sign(n) * (size - a * b));
  }

  addMulConst(x, acc, w, tmp) {
    return this.scatter(x, [[acc, w], [tmp, 1]]).move(tmp, x);
  }

  addMul(a, b, acc, [keep, tmp]) {
    this.loop(a, () => {
      this.add(a, -1).add(keep, 1);
      this.copy(b, acc, tmp);
    });
    return this.move(keep, a);
  }

  // ---- decision patterns --------------------------------------------------

  // Pattern "if (destructive)": run body once if cell is nonzero; cell ends 0.
  ifNonZero(cell, body) {
    return this.loop(cell, () => {
      body();
      this.clear(cell);
    });
  }

  // Pattern "if (keeping the value)": test a copy instead of the original.
  whenNonZero(cell, [t0, t1], body) {
    return this.copy(cell, t0, t1).ifNonZero(t0, body);
  }

  // Pattern "if zero": start a flag at 1 and knock it down when nonzero.
  whenZero(cell, [t0, t1, flag], body) {
    this.add(flag, 1);
    this.whenNonZero(cell, [t0, t1], () => this.add(flag, -1));
    return this.ifNonZero(flag, body);
  }

  satSub(cell, n, [cnt, t0, t1]) {
    this.addConst(cnt, n, t0);
    return this.loop(cnt, () => {
      this.add(cnt, -1);
      this.whenNonZero(cell, [t0, t1], () => this.add(cell, -1));
    });
  }

  toString() {
    return this.code.join('');
  }
}

module.exports = { Emitter };
