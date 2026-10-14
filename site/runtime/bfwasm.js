// Brainfuck -> WebAssembly compiler (Node and browsers, no dependencies).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BFWasm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ADD = 0, OUT = 1, IN = 2, JZ = 3, JNZ = 4, CLEAR = 5, MUL1 = 6, MUL2 = 7, MULN = 8, NOP = 9;

  // ---------------------------------------------------------------- parser
  const CLS = new Uint8Array(256);
  CLS[43] = 1; CLS[45] = 2; CLS[62] = 3; CLS[60] = 4; CLS[46] = 5; CLS[44] = 6; CLS[91] = 7; CLS[93] = 8;

  function toBytes(src) {
    if (typeof src !== 'string') return src;
    if (typeof Buffer !== 'undefined') return Buffer.from(src, 'latin1');
    const b = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) b[i] = src.charCodeAt(i) > 127 ? 0 : src.charCodeAt(i);
    return b;
  }

  function parse(src) {
    const s = toBytes(src), len = s.length;
    let cap = 1 << 16;
    let T = new Uint8Array(cap), N = new Int32Array(cap), M = new Int32Array(cap);
    let X = new Int32Array(1 << 12), xn = 0;
    let stack = new Int32Array(256), sp = 0;
    let n = 0, mv = 0, lastNonAdd = -1, i = 0;
    const so = [], sf = []; // scratch for multiply loops
    const grow = () => {
      cap *= 2;
      const t = new Uint8Array(cap); t.set(T); T = t;
      const a = new Int32Array(cap); a.set(N); N = a;
      const m = new M.constructor(cap); m.set(M); M = m;
    };
    while (i < len) {
      const c = CLS[s[i]];
      if (c === 0) { i++; continue; }
      if (c <= 2) {
        let k = 0;
        for (; i < len; i++) {
          const d = CLS[s[i]];
          if (d === 1) k++; else if (d === 2) k--; else if (d !== 0) break;
        }
        if (k !== 0) {
          if (n === cap) grow();
          T[n] = ADD; N[n] = k; M[n] = mv; mv = 0; n++;
        }
      } else if (c <= 4) {
        for (; i < len; i++) {
          const d = CLS[s[i]];
          if (d === 3) mv++; else if (d === 4) mv--; else if (d !== 0) break;
        }
        if ((mv | 0) !== mv && M instanceof Int32Array) M = new Float64Array(M); // a move of 2^31 cells or more (only a 64-bit memory has room for it)
      } else if (c === 5 || c === 6) {
        if (n === cap) grow();
        T[n] = c === 5 ? OUT : IN; N[n] = 0; M[n] = mv; mv = 0; lastNonAdd = n; n++; i++;
      } else if (c === 7) {
        if (sp === stack.length) { const st = new Int32Array(sp * 2); st.set(stack); stack = st; }
        stack[sp++] = n;
        if (n === cap) grow();
        T[n] = JZ; N[n] = 0; M[n] = mv; mv = 0; lastNonAdd = n; n++; i++;
      } else {
        i++;
        if (sp === 0) throw new Error('unmatched ]');
        const start = stack[--sp];
        let cnt = -1;
        if (lastNonAdd === start) {
          // body is only adds: is it a multiplication?
          let tot = mv;
          for (let q = start + 1; q < n; q++) tot += M[q];
          if (tot === 0) {
            let off = 0, zero = 0, hasZero = false, m = 0;
            const body = n - start - 1;
            if (body <= 24) {
              for (let q = start + 1; q < n; q++) {
                off += M[q];
                if (off === 0) { zero += N[q]; hasZero = true; continue; }
                let j = 0;
                while (j < m && so[j] !== off) j++;
                if (j === m) { so[m] = off; sf[m] = N[q]; m++; } else sf[j] += N[q];
              }
            } else {
              const map = new Map();
              for (let q = start + 1; q < n; q++) {
                off += M[q];
                if (off === 0) { zero += N[q]; hasZero = true; continue; }
                map.set(off, (map.get(off) || 0) + N[q]);
              }
              for (const [o, f] of map) { so[m] = o; sf[m] = f; m++; }
            }
            let fits = true; // X holds the offsets as int32
            for (let j = 0; j < m; j++) if (so[j] > 0x7fffffff || so[j] < -0x7fffffff) fits = false;
            if (hasZero && zero === -1 && fits) {
              cnt = 0;
              for (let j = 0; j < m; j++) if (sf[j] !== 0) { so[cnt] = so[j]; sf[cnt] = sf[j]; cnt++; }
            }
          }
        }
        if (cnt >= 0) {
          mv = M[start];
          n = start;
          let nv = 0;
          if (cnt > 0) {
            if (xn + 2 * cnt + 1 > X.length) {
              let c2 = X.length * 2;
              while (c2 < xn + 2 * cnt + 1) c2 *= 2;
              const x = new Int32Array(c2); x.set(X); X = x;
            }
            nv = xn;
            if (cnt > 2) X[xn++] = cnt;
            for (let j = 0; j < cnt; j++) { X[xn++] = so[j]; X[xn++] = sf[j]; }
          }
          T[n] = cnt === 0 ? CLEAR : cnt === 1 ? MUL1 : cnt === 2 ? MUL2 : MULN;
          N[n] = nv; M[n] = mv; mv = 0; lastNonAdd = n; n++;
        } else {
          if (n === cap) grow();
          T[n] = JNZ; N[n] = start + 1; M[n] = mv; mv = 0; lastNonAdd = n; n++;
          N[start] = n;
        }
      }
    }
    if (sp) throw new Error('unmatched [');
    if (mv) {
      if (n === cap) grow();
      T[n] = NOP; N[n] = 0; M[n] = mv; n++;
    }
    return { T: T.slice(0, n), N: N.slice(0, n), M: M.slice(0, n), X: X.slice(0, xn), length: n };
  }

  // ---------------------------------------------------------------- byte buffer
  class Buf {
    constructor(n) { this.b = new Uint8Array(n || 1024); this.n = 0; }
    ensure(k) {
      if (this.n + k <= this.b.length) return;
      let c = this.b.length * 2;
      while (c < this.n + k) c *= 2;
      const nb = new Uint8Array(c);
      nb.set(this.b.subarray(0, this.n));
      this.b = nb;
    }
    u8(x) { if (this.n === this.b.length) this.ensure(1); this.b[this.n++] = x; }
    uleb(x) {
      x >>>= 0;
      do { let c = x & 127; x >>>= 7; if (x) c |= 128; this.u8(c); } while (x);
    }
    sleb(x) {
      x |= 0;
      for (;;) {
        const c = x & 127;
        x >>= 7;
        if ((x === 0 && !(c & 64)) || (x === -1 && (c & 64))) { this.u8(c); return; }
        this.u8(c | 128);
      }
    }
    // the same for whole numbers of up to 53 bits (a 64-bit memory's offsets and pointer constants)
    uleb64(x) {
      if (x < 4294967296) { this.uleb(x); return; }
      do { let c = x % 128; x = Math.floor(x / 128); if (x) c |= 128; this.u8(c); } while (x);
    }
    sleb64(x) {
      if (x >= -2147483648 && x <= 2147483647) { this.sleb(x); return; }
      for (;;) {
        const q = Math.floor(x / 128), c = x - q * 128;
        x = q;
        if ((x === 0 && !(c & 64)) || (x === -1 && (c & 64))) { this.u8(c); return; }
        this.u8(c | 128);
      }
    }
    bytes(arr) { this.ensure(arr.length); this.b.set(arr, this.n); this.n += arr.length; }
    append(buf) { this.ensure(buf.n); this.b.set(buf.b.subarray(0, buf.n), this.n); this.n += buf.n; }
    str(s) { this.uleb(s.length); for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  }

  // ---------------------------------------------------------------- memory layout
  const INBUF = 0, IOSIZE = 65536, OUTBUF = 65536;
  const BASE = 1 << 20;       // tape starts here; everything below is I/O buffers + zero guard
  const GUARD = 1 << 20;      // zero guard after the tape
  const SAFE = 100000;
  const MAX_BODY = 7654321;   // engine limit on one function body (V8, SpiderMonkey, JSC)
  const MAX_FUNCS = 1000000;  // engine limit on functions per module
  const MAX_LOCALS = 50000;   // engine limit on locals per function
  const MAX_PAGES = 262144;   // engine limit on a 64-bit memory (V8: 16 GiB)

  // ---------------------------------------------------------------- code generator
  // o: cellBits 8 | 16 | 32, tapeSize, the tuning limits read below, and two choices:
  //   memory 'own' | 'imported': imported = the tape is env.mem and the program starts at the byte offset in the global sp
  //   address 32 | 64: the memory's address width; 64 = a tape of more than 4 GiB
  function generate(prog, o) {
    o = o || {};
    const T = prog.T, N = prog.N, M = prog.M, X = prog.X, n = prog.length;
    const bits = o.cellBits || 16;
    if (bits !== 8 && bits !== 16 && bits !== 32) throw new Error('cellBits must be 8, 16 or 32');
    const memory = o.memory || 'own', address = o.address || 32;
    if (memory !== 'own' && memory !== 'imported') throw new Error("memory must be 'own' or 'imported'");
    if (address !== 32 && address !== 64) throw new Error('address must be 32 or 64');
    const imported = memory === 'imported', mem64 = address === 64;
    if (mem64) explicitBoundsChecks();
    const size = bits >> 3, shift = size === 1 ? 0 : size === 2 ? 1 : 2;
    const mask = bits === 32 ? -1 : (1 << bits) - 1;
    const wrap = bits === 32 ? (k) => k | 0 : (k) => k & mask;
    const MINUS1 = wrap(-1);
    const tapeSize = o.tapeSize || 65536;
    const pages = pagesFor(tapeSize, bits);
    if (mem64 && pages > MAX_PAGES) throw new Error('tape of ' + tapeSize + ' cells needs ' + pages + ' pages; the limit of a 64-bit memory in V8 is ' + MAX_PAGES + ' (16 GB)');
    const inlineMax = o.inlineMax || 4000;
    const funcMax = o.funcMax || 8000;
    const promoteMax = o.promoteMax === undefined ? 1024 : o.promoteMax;
    const mulBranch = o.mulBranch === undefined ? 4 : o.mulBranch;
    const doSummarise = o.summarise !== false;
    const peelMax = o.peelMax === undefined ? 8000 : o.peelMax;
    const noCache = o.cache === false;
    const coldTop = o.coldTop !== false;
    const coldMin = o.coldMin === undefined ? 24 : o.coldMin;
    const COLD_FUNCS = 200000;
    const LOADOP = size === 1 ? 0x2D : size === 2 ? 0x2F : 0x28;
    const STOREOP = size === 1 ? 0x3A : size === 2 ? 0x3B : 0x36;

    // prefix sums: weight, pointer movement (beyond 2^31 cells on a 64-bit memory), unbalanced loops
    const PW = new Uint32Array(n + 1), PM = mem64 ? new Float64Array(n + 1) : new Int32Array(n + 1), PU = new Int32Array(n + 1);
    {
      let st = new Int32Array(256), sp = 0, ub = 0;
      let ubAt = new Int32Array(256);
      for (let i = 0; i < n; i++) {
        const t = T[i];
        let w = 1;
        if (t === MUL1) w = 2; else if (t === MUL2) w = 3; else if (t === MULN) w = 1 + X[N[i]];
        PW[i + 1] = PW[i] + w;
        PM[i + 1] = PM[i] + M[i];
        let flag = 0;
        if (t === JZ) {
          if (sp === st.length) {
            const a = new Int32Array(sp * 2); a.set(st); st = a;
            const b = new Int32Array(sp * 2); b.set(ubAt); ubAt = b;
          }
          st[sp] = i; ubAt[sp] = ub; sp++;
        } else if (t === JNZ) {
          sp--;
          const jz = st[sp];
          if (PM[i + 1] - PM[jz + 1] !== 0 || ub !== ubAt[sp]) { flag = 1; ub++; }
        }
        PU[i + 1] = PU[i] + flag;
      }
    }

    const FIRST = 5; // imports flush, refill; then $out, $in, $run; then program functions
    const OUTF = 2, INF = 3;
    const funcs = [];
    const ftypes = [];
    function newFunc(a, b, tail, cold, noSplit) {
      const dyn = PU[b] - PU[a] !== 0;
      const f = { a, b, tail, cold, noSplit, dyn, idx: FIRST + funcs.length };
      funcs.push(f);
      ftypes.push(dyn ? 0 : 1);
      return f;
    }

    // per-function state
    const B = new Buf(1 << 16);
    let off = 0, nLoc = 0, pinDepth = 0, peelBudget = 0, cold = false;
    const cache = new Map();
    const created = [];
    const freeL = [];
    const stats = { functions: 0, summarised: 0, guardedDec: 0, peeledLoops: 0, peeled: 0, promoted: 0, ifs: 0, loops: 0, outlined: 0, maxBody: 0, maxLocals: 0 };

    const allocLocal = () => (freeL.length ? freeL.pop() : ++nLoc);
    const konst = (k) => { B.u8(0x41); B.sleb(k); };
    const lget = (l) => { B.u8(0x20); B.uleb(l); };
    const lset = (l) => { B.u8(0x21); B.uleb(l); };
    // the pointer (local 0) is a byte offset: an i32, or an i64 on a 64-bit memory
    const pconst = (k, b = B) => { if (mem64) { b.u8(0x42); b.sleb64(k); } else { b.u8(0x41); b.sleb(k); } };
    const padd = (b = B) => b.u8(mem64 ? 0x7C : 0x6A);
    function pushAddr(o) {
      B.u8(0x20); B.u8(0);
      const d = BASE + o * size;
      if (d >= 0 && (mem64 || d < 0x7fff0000)) return d;
      pconst(o * size); padd();
      return BASE;
    }
    const load = (mo) => { B.u8(LOADOP); B.u8(shift); B.uleb64(mo); };
    const store = (mo) => { B.u8(STOREOP); B.u8(shift); B.uleb64(mo); };
    function mk(o, loc, k, dirty) {
      const e = { o, loc, k, dirty, raw: false, pin: false };
      cache.set(o, e);
      created.push(e);
      return e;
    }
    function pushVal(o) {
      const e = cache.get(o);
      if (!e) {
        const l = allocLocal();
        load(pushAddr(o));
        B.u8(0x22); B.uleb(l);
        return mk(o, l, null, false);
      }
      if (e.k !== null) konst(e.k); else lget(e.loc);
      return e;
    }
    function ensureLocal(o) {
      let e = cache.get(o);
      if (!e) {
        const l = allocLocal();
        load(pushAddr(o));
        lset(l);
        e = mk(o, l, null, false);
      } else if (e.k !== null) {
        if (e.loc < 0) e.loc = allocLocal();
        konst(e.k); lset(e.loc);
        e.k = null; e.raw = false;
      }
      return e;
    }
    // pushes the cell value normalised to the cell width; returns 0/1 if known, else -1
    function pushTest(o) {
      const e = cache.get(o);
      if (!e) { load(pushAddr(o)); return -1; }
      if (e.k !== null) { konst(e.k !== 0 ? 1 : 0); return e.k !== 0 ? 1 : 0; }
      lget(e.loc);
      if (e.raw && bits < 32) { konst(mask); B.u8(0x71); }
      return -1;
    }
    function setTop(o) {
      let e = cache.get(o);
      if (!e) e = mk(o, allocLocal(), null, true);
      else if (e.loc < 0) e.loc = allocLocal();
      lset(e.loc);
      e.k = null; e.dirty = true; e.raw = true;
    }
    function setConst(o, k) {
      const e = cache.get(o);
      if (!e) mk(o, -1, k, true);
      else { e.k = k; e.dirty = true; }
    }
    function setZeroClean(o) {
      const e = cache.get(o);
      if (e) e.k = 0; else mk(o, -1, 0, false);
    }
    function storeE(e) {
      const mo = pushAddr(e.o);
      if (e.k !== null) konst(e.k); else lget(e.loc);
      store(mo);
      e.dirty = false;
    }
    function syncAll() {
      cache.forEach((e) => {
        if (e.dirty) storeE(e);
        if (e.loc >= 0) freeL.push(e.loc);
      });
      cache.clear();
      created.length = 0;
    }
    function syncWritten(wr, base) {
      for (let j = 0; j < wr.length; j++) {
        const e = cache.get(base + wr[j]);
        if (!e) continue;
        if (e.pin) {
          if (e.k !== null) {
            if (e.loc < 0) e.loc = allocLocal();
            konst(e.k); lset(e.loc);
            e.k = null;
          }
          e.raw = true;
        } else {
          if (e.dirty) storeE(e);
          if (e.loc >= 0) freeL.push(e.loc);
          cache.delete(e.o);
        }
      }
    }
    function dropNew(mark) {
      while (created.length > mark) {
        const e = created.pop();
        if (cache.get(e.o) !== e || e.pin) continue;
        if (e.dirty) storeE(e);
        if (e.loc >= 0) freeL.push(e.loc);
        cache.delete(e.o);
      }
    }
    function realiseP() {
      if (off !== 0) { lget(0); pconst(off * size); padd(); lset(0); off = 0; }
    }

    function opAdd(o, k) {
      const e = cache.get(o);
      if (e && e.k !== null) { e.k = wrap(e.k + k); e.dirty = true; return; }
      pushVal(o); konst(k); B.u8(0x6A); setTop(o);
    }
    function mulAdd(o, srcLocal, f) { // t[o] += local * f
      pushVal(o);
      lget(srcLocal);
      if (f === 1) B.u8(0x6A);
      else if (f === -1) B.u8(0x6B);
      else { konst(f); B.u8(0x6C); B.u8(0x6A); }
      setTop(o);
    }
    function opMul(i) {
      const t = T[i], o = off;
      let q = N[i], pc = t === MUL1 ? 1 : 2;
      if (t === MULN) { pc = X[q]; q++; }
      let e = cache.get(o);
      if (e && e.k !== null) {
        const c = e.k;
        if (c !== 0) {
          for (let j = 0; j < pc; j++) opAdd(o + X[q + 2 * j], Math.imul(c, X[q + 2 * j + 1]));
          e.k = 0; e.dirty = true;
        }
        return;
      }
      let far = false;
      for (let j = 0; j < pc; j++) { const x = X[q + 2 * j]; if (x > SAFE || x < -SAFE) far = true; }
      if (pc <= mulBranch && !far) {
        e = ensureLocal(o);
        const sl = e.loc;
        for (let j = 0; j < pc; j++) mulAdd(o + X[q + 2 * j], sl, X[q + 2 * j + 1]);
        setConst(o, 0);
        return;
      }
      const tmp = allocLocal();
      if (e) lget(e.loc); else load(pushAddr(o));
      B.u8(0x22); B.uleb(tmp);
      if (e && e.raw && bits < 32) { konst(mask); B.u8(0x71); }
      const wr = new Array(pc + 1);
      wr[0] = 0;
      for (let j = 0; j < pc; j++) wr[j + 1] = X[q + 2 * j];
      syncWritten(wr, o);
      const mark = created.length;
      B.u8(0x04); B.u8(0x40);
      for (let j = 0; j < pc; j++) {
        const to = o + X[q + 2 * j], f = X[q + 2 * j + 1];
        if (cache.has(to)) { mulAdd(to, tmp, f); continue; }
        // not cached: update memory directly (no local per target)
        const mo = pushAddr(to);
        load(pushAddr(to));
        lget(tmp);
        if (f === 1) B.u8(0x6A);
        else if (f === -1) B.u8(0x6B);
        else { konst(f); B.u8(0x6C); B.u8(0x6A); }
        store(mo);
      }
      setConst(o, 0);
      syncWritten(wr, o);
      dropNew(mark);
      B.u8(0x0B);
      freeL.push(tmp);
      setZeroClean(o);
    }

    // offsets (relative to the loop cell) touched by a balanced loop
    function scan(i, jnz) {
      const W = new Set(), R = new Set();
      let o = 0, leaf = true, lo = 0, hi = 0;
      R.add(0); W.add(0); // the loop cell counts as written: it is known to be zero afterwards
      for (let q = i + 1; q <= jnz; q++) {
        o += M[q];
        if (o < lo) lo = o; else if (o > hi) hi = o;
        const t = T[q];
        if (t === ADD || t === CLEAR) W.add(o);
        else if (t === IN) { W.add(o); leaf = false; }
        else if (t === OUT) { R.add(o); leaf = false; }
        else if (t === JNZ) R.add(o);
        else if (t === JZ) { W.add(o); leaf = false; } // a loop leaves its cell known-zero: counts as a write
        else if (t !== NOP) {
          W.add(o);
          let x = N[q], pc = t === MUL1 ? 1 : 2;
          if (t === MULN) { pc = X[x]; x++; }
          for (let j = 0; j < pc; j++) {
            const y = o + X[x + 2 * j];
            W.add(y);
            if (y < lo) lo = y; else if (y > hi) hi = y;
          }
        }
      }
      const wr = Array.from(W);
      for (const r of W) R.add(r);
      return { W, wr, all: Array.from(R), leaf, near: lo >= -SAFE && hi <= SAFE };
    }

    // ---- symbolic execution of a straight-line loop body: every cell becomes
    function symRange(a, b, A, S, o) {
      let terms = 0;
      const get = (o) => {
        let e = S.get(o);
        if (!e) {
          e = A.has(o) ? { c: A.get(o), t: new Map() } : { c: 0, t: new Map([[o, 1]]) };
          S.set(o, e);
        }
        return e;
      };
      for (let q = a; q < b; q++) {
        o += M[q];
        const t = T[q];
        if (t === ADD) { const e = get(o); e.c = (e.c + N[q]) | 0; }
        else if (t === CLEAR) S.set(o, { c: 0, t: new Map() });
        else if (t === MUL1 || t === MUL2 || t === MULN) {
          const s = get(o);
          let x = N[q], pc = t === MUL1 ? 1 : 2;
          if (t === MULN) { pc = X[x]; x++; }
          if (s.c !== 0 || s.t.size) {
            for (let j = 0; j < pc; j++) {
              const f = X[x + 2 * j + 1], g = get(o + X[x + 2 * j]);
              g.c = (g.c + Math.imul(s.c, f)) | 0;
              for (const [y, cf] of s.t) {
                const nv = ((g.t.get(y) || 0) + Math.imul(cf, f)) | 0;
                if (nv === 0) g.t.delete(y); else g.t.set(y, nv);
                if (++terms > 4000) return null;
              }
            }
          }
          S.set(o, { c: 0, t: new Map() });
        } else return null;
      }
      return o;
    }
    function normS(S) { // copy with everything reduced to the cell width
      const R = new Map();
      for (const [r, e] of S) {
        const t = new Map();
        for (const [y, cf] of e.t) { const w = wrap(cf); if (w !== 0) t.set(y, w); }
        R.set(r, { c: wrap(e.c), t });
      }
      return R;
    }
    function sym(i, jnz, A) {
      const S = new Map();
      if (symRange(i + 1, jnz, A, S, 0) === null) return null;
      return normS(S);
    }
    const isIdent = (e, r) => e.c === 0 && e.t.size === 1 && e.t.get(r) === 1;
    function tryGuardedDec(i, jnz, sc) {
      const L = off;
      const eL = cache.get(L);
      if (eL && eL.k !== null) return false;
      let q = i + 1;
      while (q < jnz && T[q] !== JZ) q++;
      if (q >= jnz || N[q] !== jnz) return false;
      const A0 = new Map();
      for (const r of sc.all) {
        if (r === 0) continue;
        const e = cache.get(L + r);
        if (e && e.k !== null) A0.set(r, e.k);
      }
      const S = new Map();
      let o = symRange(i + 1, q, A0, S, 0);
      if (o === null) return false;
      const tq = o + M[q];
      const P = normS(S);
      const eT = P.get(tq);
      if (!eT || eT.c !== 0 || eT.t.size !== 1) return false;
      const Y = eT.t.keys().next().value;
      if (eT.t.get(Y) !== 1 || Y === 0 || Y === tq) return false;
      if (!isIdent(P.get(Y), Y)) return false;
      const S2 = new Map();
      for (const [r, e] of S) S2.set(r, { c: e.c, t: new Map(e.t) });
      o = symRange(q + 1, jnz - 1, A0, S2, tq);
      if (o === null || o + M[jnz - 1] !== tq || tq + M[jnz] !== 0) return false;
      const K = normS(S2);
      const dec = (e, r) => e && e.c === MINUS1 && e.t.size === 1 && e.t.get(r) === 1;
      if (!dec(P.get(0), 0) || !dec(K.get(0), 0) || !dec(K.get(Y), Y)) return false;
      const same = (e, r, dropY) => {
        let n = e.t.size;
        if (dropY && e.t.has(Y)) n--;
        if (n === 0) return A0.has(r) && A0.get(r) === e.c;
        return n === 1 && e.c === 0 && e.t.get(r) === 1 && r !== Y;
      };
      for (const [r, e] of K) if (r !== 0 && r !== Y && !same(e, r, false)) return false;
      for (const [r, e] of P) if (r !== 0 && r !== Y && !same(e, r, true)) return false;
      const ty = allocLocal(), tn = allocLocal();
      pushTest(L + Y); lset(ty);
      pushTest(L); lset(tn);
      lget(ty); lget(ty); lget(tn); lget(ty); lget(tn); B.u8(0x49); B.u8(0x1B); B.u8(0x6B);
      setTop(L + Y);
      setConst(L, 0);
      freeL.push(ty, tn);
      stats.guardedDec++;
      return true;
    }
    function classify(S, A) {
      const eL = S.get(0);
      if (!eL || eL.t.size !== 1 || eL.t.get(0) !== 1) return null;
      if (eL.c !== MINUS1 && eL.c !== 1) return null;
      const ident = new Set(), accs = [];
      for (const [r, ex] of S) {
        if (r === 0) continue;
        if (ex.t.size === 0) { if (!(A.has(r) && A.get(r) === ex.c)) return null; continue; }
        if (A.has(r)) return null;
        if (ex.t.get(r) !== 1) return null;
        if (ex.t.size === 1 && ex.c === 0) { ident.add(r); continue; }
        const terms = [];
        for (const [y, cf] of ex.t) if (y !== r) terms.push([y, cf]);
        accs.push({ r, c: ex.c, terms });
      }
      for (const a of accs) for (const [y] of a.terms) if (y === 0 || !ident.has(y)) return null;
      return { down: eL.c === MINUS1, accs };
    }
    const small = (k) => (bits < 32 && k > (mask >> 1) ? k - mask - 1 : k);
    function emitClosed(cl, L) {
      const tmp = allocLocal();
      if (cl.down) pushVal(L); else { konst(0); pushVal(L); B.u8(0x6B); }
      lset(tmp);
      for (const a of cl.accs) {
        pushVal(L + a.r);
        lget(tmp);
        if (a.terms.length === 0) {
          if (a.c !== 1) { konst(small(a.c)); B.u8(0x6C); }
        } else {
          let first = true;
          if (a.c !== 0) { konst(small(a.c)); first = false; }
          for (const [y, cf] of a.terms) {
            pushVal(L + y);
            if (cf !== 1) { konst(small(cf)); B.u8(0x6C); }
            if (!first) B.u8(0x6A);
            first = false;
          }
          B.u8(0x6C);
        }
        B.u8(0x6A);
        setTop(L + a.r);
      }
      setConst(L, 0);
      freeL.push(tmp);
    }
    function trySummarise(i, jnz, sc) {
      const L = off;
      const eL = cache.get(L);
      if (eL && eL.k !== null) return false;
      const A0 = new Map();
      for (const r of sc.all) {
        if (r === 0) continue;
        const e = cache.get(L + r);
        if (e && e.k !== null) A0.set(r, e.k);
      }
      let S = sym(i, jnz, A0);
      if (!S) return false;
      let cl = classify(S, A0);
      let peel = null;
      if (!cl) {
        peel = new Map();
        for (const [r, ex] of S) if (r !== 0 && ex.t.size === 0) peel.set(r, ex.c);
        if (peel.size === 0) return false;
        S = sym(i, jnz, peel);
        if (!S) return false;
        cl = classify(S, peel);
        if (!cl) return false;
      }
      if (!peel && cl.accs.length <= mulBranch && sc.near) {
        emitClosed(cl, L);
        stats.summarised++;
        return true;
      }
      pushTest(L);
      syncWritten(sc.wr, L);
      const mark = created.length;
      B.u8(0x04); B.u8(0x40);
      if (peel) {
        emitSeq(i + 1, jnz);
        off += M[jnz];
        for (const [r, k] of peel) {
          if (!sc.W.has(r)) continue;
          const e = cache.get(L + r);
          if (!e || e.k !== k) setConst(L + r, k);
        }
        stats.peeled++;
      }
      emitClosed(cl, L);
      syncWritten(sc.wr, L);
      dropNew(mark);
      B.u8(0x0B);
      setZeroClean(L);
      stats.summarised++;
      return true;
    }

    function isIfLoop(i) {
      const jnz = N[i] - 1;
      return jnz - 1 > i && M[jnz] === 0 && T[jnz - 1] === CLEAR;
    }

    function doLoop(i) {
      const end = N[i], jnz = end - 1, L = off;
      const e0 = cache.get(L);
      if (e0 && e0.k === 0) return; // cell known to be zero: loop never runs
      const w = PW[end] - PW[i];
      const isIf = isIfLoop(i);
      const bodyStatic = PU[jnz] - PU[i + 1] === 0;
      const net = bodyStatic ? PM[end] - PM[i + 1] : 0;
      const balanced = bodyStatic && net === 0;
      const coldBig = cold && w >= coldMin;
      if (w > inlineMax || (coldBig && !isIf && funcs.length < COLD_FUNCS)) {
        const f = newFunc(i + 1, jnz, M[jnz], cold && isIf, false);
        stats.outlined++;
        pushTest(L); syncAll(); realiseP();
        B.u8(0x04); B.u8(0x40);
        if (!isIf) { B.u8(0x03); B.u8(0x40); }
        lget(0); B.u8(0x10); B.uleb(f.idx);
        if (f.dyn) lset(0);
        else if (net) { lget(0); pconst(net * size); padd(); lset(0); }
        if (!isIf) { load(pushAddr(0)); B.u8(0x0D); B.u8(0); B.u8(0x0B); }
        B.u8(0x0B);
        mk(0, -1, 0, false);
        return;
      }
      if (!balanced || coldBig) {
        pushTest(L); syncAll(); realiseP();
        B.u8(0x04); B.u8(0x40);
        if (!isIf) { B.u8(0x03); B.u8(0x40); }
        emitSeq(i + 1, jnz);
        off += M[jnz];
        syncAll(); realiseP();
        if (!isIf) { load(pushAddr(0)); B.u8(0x0D); B.u8(0); B.u8(0x0B); }
        B.u8(0x0B);
        mk(0, -1, 0, false);
        if (isIf) stats.ifs++; else stats.loops++;
        return;
      }
      const sc = scan(i, jnz);
      const summ = () => doSummarise && (sc.leaf ? trySummarise(i, jnz, sc) : sc.near && tryGuardedDec(i, jnz, sc));
      if (!isIf && summ()) return;
      const promote = !isIf && pinDepth === 0 && sc.all.length <= promoteMax && sc.near;
      if (isIf) stats.ifs++; else if (promote) stats.promoted++; else stats.loops++;
      pushTest(L);
      syncWritten(sc.wr, L);
      const mark = created.length;
      B.u8(0x04); B.u8(0x40);
      const fresh = [];
      if (promote) {
        // the whole loop nest runs on wasm locals: load the cells once, store them once
        for (const r of sc.all) {
          let e = cache.get(L + r);
          if (!e) {
            const l = allocLocal();
            load(pushAddr(L + r)); lset(l);
            e = mk(L + r, l, null, false);
            fresh.push(e);
          }
          e.pin = true;
          if (sc.W.has(r)) e.raw = true;
        }
        pinDepth++;
      }
      if (!isIf) { B.u8(0x03); B.u8(0x40); }
      emitSeq(i + 1, jnz);
      off += M[jnz];
      let back = !isIf;
      if (back) { const e = cache.get(L); if (e && e.k === 0) back = false; }
      let C1 = null;
      if (back && w <= peelMax && w <= peelBudget) {
        for (const r of sc.wr) {
          if (r === 0) continue;
          const e = cache.get(L + r);
          if (e && e.k !== null) (C1 || (C1 = [])).push([r, e.k]);
        }
      }
      const head = (mk0) => { // put the cache in the state "only C1 known"
        syncWritten(sc.wr, L);
        dropNew(mk0);
        for (const [r, k] of C1) {
          const e = cache.get(L + r);
          if (e) e.k = k; else mk(L + r, -1, k, false);
        }
      };
      if (C1) {
        stats.peeledLoops++;
        peelBudget -= w;
        B.u8(0x0B); // first round done; its `loop` has no back edge
        head(mark);
        if (!summ()) {
          pushTest(L);
          B.u8(0x04); B.u8(0x40); B.u8(0x03); B.u8(0x40);
          const mark2 = created.length;
          emitSeq(i + 1, jnz);
          off += M[jnz];
          let back2 = true, pushed = false;
          { const e = cache.get(L); if (e && e.k === 0) back2 = false; }
          for (const [r, k] of C1) { const e = cache.get(L + r); if (!e || e.k !== k) setConst(L + r, k); }
          if (back2 && cache.has(L)) { pushTest(L); pushed = true; }
          head(mark2);
          if (back2) { if (!pushed) load(pushAddr(L)); B.u8(0x0D); B.u8(0); }
          B.u8(0x0B); B.u8(0x0B);
        }
        syncWritten(sc.wr, L);
        dropNew(mark);
      } else {
        let pushed = false;
        if (back && cache.has(L)) { pushTest(L); pushed = true; }
        syncWritten(sc.wr, L);
        dropNew(mark);
        if (back) { if (!pushed) load(pushAddr(L)); B.u8(0x0D); B.u8(0); }
        if (!isIf) B.u8(0x0B);
      }
      if (promote) {
        pinDepth--;
        for (const r of sc.all) { const e = cache.get(L + r); if (e) e.pin = false; }
        for (const f of fresh) {
          if (cache.get(f.o) !== f) continue;
          if (sc.W.has(f.o - L)) storeE(f);
          if (f.loc >= 0) freeL.push(f.loc);
          cache.delete(f.o);
        }
      }
      B.u8(0x0B);
      setZeroClean(L);
    }

    function emitSeq(a, b) {
      let i = a;
      while (i < b) {
        const t = T[i];
        off += M[i];
        switch (t) {
          case ADD: opAdd(off, N[i]); i++; break;
          case CLEAR: setConst(off, 0); i++; break;
          case MUL1: case MUL2: case MULN: opMul(i); i++; break;
          case OUT: pushVal(off); konst(255); B.u8(0x71); B.u8(0x10); B.uleb(OUTF); i++; break;
          case IN: B.u8(0x10); B.uleb(INF); setTop(off); cache.get(off).raw = false; i++; break;
          case JZ: doLoop(i); i = N[i]; break;
          case NOP: i++; break;
          default: throw new Error('bad op stream at ' + i);
        }
        if (noCache && pinDepth === 0) syncAll();
      }
    }

    function itemCost(i) {
      const w = PW[N[i]] - PW[i];
      if (w > inlineMax) return 8;
      if (cold && w >= coldMin && !isIfLoop(i)) return 8;
      return w;
    }
    function callRange(ca, cb) {
      const f = newFunc(ca, cb, 0, cold, true);
      syncAll();
      if (!f.dyn) {
        lget(0);
        if (off) { pconst(off * size); padd(); }
        B.u8(0x10); B.uleb(f.idx);
        off += PM[cb] - PM[ca];
      } else {
        realiseP();
        lget(0); B.u8(0x10); B.uleb(f.idx); lset(0);
      }
    }

    const code = new Buf(1 << 20);
    const hdr = new Buf(16);
    function genFunc(f) {
      B.n = 0; off = 0; nLoc = 0; pinDepth = 0; peelBudget = 4 * funcMax; cold = f.cold;
      cache.clear(); created.length = 0; freeL.length = 0;
      let split = false;
      if (!f.noSplit) {
        let cost = 0;
        for (let i = f.a; i < f.b && cost <= funcMax;) {
          if (T[i] === JZ) { cost += itemCost(i); i = N[i]; } else { cost += PW[i + 1] - PW[i]; i++; }
        }
        split = cost > funcMax;
      }
      if (!split) emitSeq(f.a, f.b);
      else {
        let start = f.a, acc = 0, i = f.a;
        while (i < f.b) {
          if (T[i] === JZ) { acc += itemCost(i); i = N[i]; } else { acc += PW[i + 1] - PW[i]; i++; }
          if (acc >= funcMax || i === f.b) { callRange(start, i); start = i; acc = 0; }
        }
      }
      off += f.tail;
      syncAll();
      if (f.dyn) { lget(0); if (off) { pconst(off * size); padd(); } }
      B.u8(0x0B);
      hdr.n = 0;
      if (nLoc > 0) { hdr.u8(1); hdr.uleb(nLoc); hdr.u8(0x7F); } else hdr.u8(0);
      const sz = hdr.n + B.n;
      if (sz > MAX_BODY) throw new Error('function body of ' + sz + ' bytes exceeds the WebAssembly limit; lower funcMax/inlineMax');
      if (nLoc + 1 > MAX_LOCALS) throw new Error('too many locals (' + nLoc + '); lower funcMax');
      if (sz > stats.maxBody) stats.maxBody = sz;
      if (nLoc > stats.maxLocals) stats.maxLocals = nLoc;
      code.uleb(sz); code.append(hdr); code.append(B);
    }

    newFunc(0, n, 0, coldTop, false);
    for (let k = 0; k < funcs.length; k++) {
      genFunc(funcs[k]);
      if (k > 0) funcs[k] = null;
      if (funcs.length + FIRST > MAX_FUNCS) throw new Error('more than ' + MAX_FUNCS + ' functions; raise inlineMax/funcMax');
    }
    stats.functions = funcs.length;
    const main = funcs[0];

    // ---- helper function bodies
    const helper = (fn) => { const b = new Buf(64); b.u8(0); fn(b); b.u8(0x0B); const r = new Buf(64); r.uleb(b.n); r.append(b); return r; };
    const toAddr = mem64 ? [0xAD] : []; // i64.extend_i32_u: a buffer index as a 64-bit address
    const hOut = helper((b) => {
      b.bytes([0x23, 0, ...toAddr, 0x20, 0, 0x3A, 0]); b.uleb(OUTBUF);
      b.bytes([0x23, 0, 0x41, 1, 0x6A, 0x24, 0]);
      b.bytes([0x23, 0, 0x23, 1, 0x4F, 0x04, 0x40, 0x23, 0, 0x10, 0, 0x41, 0, 0x24, 0, 0x0B]);
    });
    const hIn = helper((b) => {
      b.bytes([0x23, 2, 0x23, 3, 0x4F, 0x04, 0x40, 0x10, 1, 0x24, 3, 0x41, 0, 0x24, 2,
        0x23, 3, 0x45, 0x04, 0x40, 0x41, 0, 0x0F, 0x0B, 0x0B]);
      b.bytes([0x23, 2, ...toAddr, 0x2D, 0]); b.uleb(INBUF);
      b.bytes([0x23, 2, 0x41, 1, 0x6A, 0x24, 2]);
    });
    const hRun = helper((b) => { // returns the pointer at the end
      if (imported) b.bytes([0x23, 4]); else pconst(0, b); // the start: global sp, or 0
      b.u8(0x10); b.uleb(main.idx);
      if (!main.dyn) {
        if (imported) b.bytes([0x23, 4]);
        pconst(PM[n] * size, b);
        if (imported) padd(b);
      }
    });

    const out = new Buf(code.n + ftypes.length + 4096);
    out.bytes([0, 0x61, 0x73, 0x6D, 1, 0, 0, 0]);
    const section = (id, body) => { out.u8(id); out.uleb(body.n); out.append(body); };
    const memLimits = (b) => { b.u8(mem64 ? 5 : 1); b.uleb(pages); b.uleb(pages); }; // 1: has a maximum, 5: and is 64-bit
    // types: 0 (ptr)->(ptr) and 1 (ptr)->() for the program, 2 ()->(i32), 3 ()->(); with an i64 pointer also 4 (i32)->() and 5 ()->(i64)
    let s = new Buf(64);
    if (mem64) s.bytes([6, 0x60, 1, 0x7E, 1, 0x7E, 0x60, 1, 0x7E, 0, 0x60, 0, 1, 0x7F, 0x60, 0, 0, 0x60, 1, 0x7F, 0, 0x60, 0, 1, 0x7E]);
    else s.bytes([4, 0x60, 1, 0x7F, 1, 0x7F, 0x60, 1, 0x7F, 0, 0x60, 0, 1, 0x7F, 0x60, 0, 0]);
    section(1, s);
    const outType = mem64 ? 4 : 1, runType = mem64 ? 5 : 2;
    s = new Buf(64);
    s.uleb(imported ? 3 : 2); s.str('env'); s.str('flush'); s.u8(0); s.u8(outType); s.str('env'); s.str('refill'); s.u8(0); s.u8(2);
    if (imported) { s.str('env'); s.str('mem'); s.u8(2); memLimits(s); }
    section(2, s);
    s = new Buf(ftypes.length + 16);
    s.uleb(3 + ftypes.length); s.u8(outType); s.u8(2); s.u8(runType);
    s.bytes(Uint8Array.from(ftypes));
    section(3, s);
    if (!imported) {
      s = new Buf(16);
      s.u8(1); memLimits(s);
      section(5, s);
    }
    const globals = imported ? ['op', 'ol', 'ip', 'il', 'sp'] : ['op', 'ol', 'ip', 'il'];
    s = new Buf(32);
    s.u8(globals.length);
    for (let g = 0; g < 4; g++) s.bytes([0x7F, 1, 0x41, 0, 0x0B]);
    if (imported) s.bytes(mem64 ? [0x7E, 1, 0x42, 0, 0x0B] : [0x7F, 1, 0x41, 0, 0x0B]); // sp: a pointer
    section(6, s);
    s = new Buf(64);
    s.u8(2 + globals.length); s.str('mem'); s.u8(2); s.u8(0); s.str('run'); s.u8(0); s.u8(4);
    globals.forEach((nm, g) => { s.str(nm); s.u8(3); s.u8(g); });
    section(7, s);
    // code section
    const csize = new Buf(8);
    csize.uleb(3 + funcs.length);
    out.u8(10); out.uleb(csize.n + hOut.n + hIn.n + hRun.n + code.n);
    out.append(csize); out.append(hOut); out.append(hIn); out.append(hRun); out.append(code);

    stats.ops = n;
    stats.wasmBytes = out.n;
    return { bytes: out.b.subarray(0, out.n), stats, cellBits: bits, tapeSize, pages };
  }

  // ---------------------------------------------------------------- runtime
  // memory: the WebAssembly.Memory of the tape, for a module made with memory 'imported'
  class Program {
    constructor(module, meta, memory) {
      this.module = module;
      this.cellBits = meta.cellBits;
      this.tapeSize = meta.tapeSize;
      this.stats = meta.stats;
      this._cur = null;
      this.instance = new WebAssembly.Instance(module, {
        env: { flush: (k) => this._flush(k), refill: () => this._refill(), mem: memory },
      });
      this._mem = new Uint8Array(this.instance.exports.mem.buffer);
    }
    _flush(k) {
      const c = this._cur;
      const chunk = this._mem.slice(OUTBUF, OUTBUF + k);
      if (c.onOutput) c.onOutput(chunk);
      if (c.collect) { c.chunks.push(chunk); c.total += k; }
    }
    _refill() {
      const c = this._cur;
      const k = Math.min(IOSIZE, c.input.length - c.pos);
      if (k <= 0) return 0;
      this._mem.set(c.input.subarray(c.pos, c.pos + k), INBUF);
      c.pos += k;
      return k;
    }
    // opt: onOutput, flushEvery, collect, keep (leave the tape as it is), pointer (the cell to start on: memory 'imported')
    run(input, opt) {
      opt = opt || {};
      const ex = this.instance.exports;
      let bytes = input || new Uint8Array(0);
      if (typeof bytes === 'string') {
        const b = new Uint8Array(bytes.length);
        for (let i = 0; i < b.length; i++) b[i] = bytes.charCodeAt(i);
        bytes = b;
      }
      const size = this.cellBits >> 3;
      if (!opt.keep) this._mem.fill(0, BASE, BASE + this.tapeSize * size);
      if (ex.sp) { const at = (opt.pointer || 0) * size; ex.sp.value = typeof ex.sp.value === 'bigint' ? BigInt(at) : at; } // an i64 on a 64-bit memory
      const c = this._cur = { input: bytes, pos: 0, onOutput: opt.onOutput || null, collect: opt.collect !== false, chunks: [], total: 0 };
      ex.op.value = 0; ex.ip.value = 0; ex.il.value = 0;
      ex.ol.value = opt.onOutput ? Math.min(IOSIZE, opt.flushEvery || 1) : IOSIZE;
      const p = ex.run();
      if (ex.op.value > 0) { this._flush(ex.op.value); ex.op.value = 0; }
      const output = new Uint8Array(c.total);
      let at = 0;
      for (const ch of c.chunks) { output.set(ch, at); at += ch.length; }
      this._cur = null;
      return {
        output,
        pointer: Number(p) / size,
        get text() { return latin1(output); },
      };
    }
    tape() {
      const buf = this.instance.exports.mem.buffer;
      return this.cellBits === 8 ? new Uint8Array(buf, BASE, this.tapeSize)
        : this.cellBits === 16 ? new Uint16Array(buf, BASE, this.tapeSize)
          : new Uint32Array(buf, BASE, this.tapeSize);
    }
  }
  function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return s;
  }

  // ---------------------------------------------------------------- the tape's memory (for memory 'imported')
  const pagesFor = (tapeSize, cellBits) => Math.ceil((BASE + tapeSize * (cellBits >> 3) + GUARD) / 65536);
  function newMemory(tapeSize, cellBits, address) {
    const pages = pagesFor(tapeSize, cellBits);
    if (address !== 64) return new WebAssembly.Memory({ initial: pages, maximum: pages });
    if (pages > MAX_PAGES) throw new Error(pages + ' pages is over the limit of a 64-bit memory in V8 (' + MAX_PAGES + ' pages = 16 GB)');
    explicitBoundsChecks();
    return new WebAssembly.Memory({ address: 'i64', initial: BigInt(pages), maximum: BigInt(pages) });
  }
  const tapeOf = (memory, tapeSize, cellBits) => (cellBits === 8 ? new Uint8Array(memory.buffer, BASE, tapeSize)
    : cellBits === 16 ? new Uint16Array(memory.buffer, BASE, tapeSize) : new Uint32Array(memory.buffer, BASE, tapeSize));

  // Node, before the first 64-bit memory or module: explicit bounds checks run brnfck-1.5b in about 30% less time than V8's default (trap handling)
  let checksChosen = false;
  function explicitBoundsChecks() {
    if (checksChosen || typeof process !== 'object' || !process.versions || !process.versions.v8 || typeof require !== 'function') return;
    checksChosen = true;
    try { require('v8').setFlagsFromString('--no-wasm-memory64-trap-handling'); } catch (e) { }
  }

  // opt: the options of generate; memory: the tape's WebAssembly.Memory for memory 'imported'
  const asProg = (src) => (src && src.T && src.N ? src : parse(src));
  function compileSync(src, opt, memory) {
    const g = generate(asProg(src), opt);
    return new Program(new WebAssembly.Module(g.bytes), g, memory);
  }
  async function compile(src, opt, memory) {
    const g = generate(asProg(src), opt);
    return new Program(await WebAssembly.compile(g.bytes), g, memory);
  }

  return {
    parse, generate, compile, compileSync, Program, latin1, pagesFor, newMemory, tapeOf,
    limits: { MAX_BODY, MAX_FUNCS, MAX_LOCALS, MAX_PAGES, BASE, GUARD, SAFE },
    OPS: { ADD, OUT, IN, JZ, JNZ, CLEAR, MUL1, MUL2, MULN, NOP },
  };
});
