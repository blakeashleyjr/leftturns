#!/usr/bin/env tsx
/**
 * Comprehensive EXTREME mode test using the same algorithm as astar.ts
 * but with detailed diagnostics. Tests with 5M state limit.
 */
import { readFileSync, readdirSync } from 'fs';
import { unpack } from 'msgpackr';
import { gunzipSync } from 'zlib';

// --- Load tiles ---
const dir = 'static/demo-tiles';
const files = readdirSync(dir).filter(f => f.endsWith('.bin.gz'));
const tiles = files.map(f => unpack(gunzipSync(readFileSync(`${dir}/${f}`))));

const nodes = new Map<number, { id: number; lat: number; lng: number }>();
const adjacency = new Map<number, any[]>();
for (const tile of tiles) {
  for (const n of tile.nodes) {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  }
  for (const e of tile.edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e);
  }
}
console.log(`Graph: ${nodes.size} nodes, ${Array.from(adjacency.values()).reduce((a, b) => a + b.length, 0)} edges`);

// --- Geometry (matches geometry.ts) ---
function turnAngle(i: number, o: number) { return ((o - i) % 360 + 360) % 360; }
function isLeftTurn(i: number, o: number) { const a = turnAngle(i, o); return a >= 210 && a <= 340; }
function isTurnAllowed(i: number, o: number) {
  const a = turnAngle(i, o);
  if (a <= 20 || a >= 340) return true;  // straight
  if (a >= 210 && a < 340) return true;  // left
  return false;
}
function bToBucket(d: number) { return Math.round(((d % 360 + 360) % 360) / 5) % 72; }
function bucketToB(b: number) { return b * 5; }

function hav(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// --- Used-edge chain (matches astar.ts) ---
interface Chain { from: number; to: number; parent: Chain | null; hash: number; size: number }
function chainHas(c: Chain | null, f: number, t: number): boolean {
  while (c) { if (c.from === f && c.to === t) return true; c = c.parent; }
  return false;
}
function chainAdd(c: Chain | null, f: number, t: number): Chain {
  const h = (((f * 2654435761) ^ (t * 2246822519)) >>> 0);
  return { from: f, to: t, parent: c, hash: ((c?.hash ?? 0) + h) >>> 0, size: (c?.size ?? 0) + 1 };
}

// --- State ---
interface State { n: number; b: number; c: Chain | null; h: number; sz: number }

const DEAD_END_PENALTY = 5;

// --- Diagnostics ---
interface RunResult {
  found: boolean;
  exp: number;
  dist?: number;
  steps?: number;
  reason?: string;
  maxChainSize: number;
  uniqueStateKeys: number;
  deadEndEscapes: number;
  peakQueueSize: number;
  memoryMB?: number;
}

function runExtreme(startId: number, endId: number, stateLimit: number): RunResult {
  const endN = nodes.get(endId)!;
  const heur = (id: number) => { const n = nodes.get(id); return n ? hav(n, endN) : 999999; };

  const heap: { p: number; v: State }[] = [];
  function push(p: number, v: State) {
    heap.push({ p, v }); let i = heap.length - 1;
    while (i > 0) { const pi = Math.floor((i - 1) / 2); if (heap[pi].p <= heap[i].p) break; [heap[pi], heap[i]] = [heap[i], heap[pi]]; i = pi; }
  }
  function pop(): State | null {
    if (!heap.length) return null; const t = heap[0]; const l = heap.pop()!;
    if (heap.length > 0) { heap[0] = l; let i = 0; while (true) { let s = i, a = 2 * i + 1, b = 2 * i + 2; if (a < heap.length && heap[a].p < heap[s].p) s = a; if (b < heap.length && heap[b].p < heap[s].p) s = b; if (s === i) break; [heap[i], heap[s]] = [heap[s], heap[i]]; i = s; } }
    return t.v;
  }

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, { p: string; e: any }>();
  function sk(s: State) { return `${s.n}:${s.b}:${s.h}:${s.sz}`; }

  const s0: State = { n: startId, b: -1, c: null, h: 0, sz: 0 };
  gScore.set(sk(s0), 0); push(heur(startId), s0);
  let exp = 0;
  let maxChainSize = 0;
  let deadEndEscapes = 0;
  let peakQueueSize = 0;

  while (heap.length > 0) {
    const cur = pop()!; const ck = sk(cur); exp++;
    if (heap.length > peakQueueSize) peakQueueSize = heap.length;
    if (cur.c && cur.c.size > maxChainSize) maxChainSize = cur.c.size;

    if (exp > stateLimit) {
      return {
        found: false, exp, reason: 'limit', maxChainSize,
        uniqueStateKeys: gScore.size, deadEndEscapes, peakQueueSize,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      };
    }

    if (cur.n === endId) {
      let dist = 0, steps = 0, k = ck;
      while (cameFrom.has(k)) { const { p, e } = cameFrom.get(k)!; dist += e.dist; steps++; k = p; }
      return {
        found: true, exp, dist: Math.round(dist), steps, maxChainSize,
        uniqueStateKeys: gScore.size, deadEndEscapes, peakQueueSize,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      };
    }

    const cG = gScore.get(ck) ?? Infinity;
    const allE = adjacency.get(cur.n) ?? [];
    let allowed: any[];
    let deadEnd = false;

    if (cur.b < 0) {
      allowed = allE;
    } else {
      const inc = bucketToB(cur.b);
      const fl = allE.filter((e: any) => isLeftTurn(inc, e.exitBearing) && !chainHas(cur.c, e.from, e.to));
      if (fl.length > 0) {
        allowed = fl;
      } else {
        allowed = allE.filter((e: any) => isTurnAllowed(inc, e.exitBearing));
      }
      if (allowed.length === 0 && allE.length > 0) {
        allowed = allE;
        deadEnd = true;
        deadEndEscapes++;
      }
    }

    for (const edge of allowed) {
      const penalty = deadEnd ? DEAD_END_PENALTY : 1;
      const tG = cG + edge.dist * penalty;
      const nb = bToBucket(edge.entryBearing);
      let nc = cur.c, nh = cur.h, nsz = cur.sz;
      if (cur.b >= 0 && isLeftTurn(bucketToB(cur.b), edge.exitBearing)) {
        nc = chainAdd(cur.c, edge.from, edge.to);
        nh = nc.hash;
        nsz = nc.size;
      }
      const ns: State = { n: edge.to, b: nb, c: nc, h: nh, sz: nsz };
      const nk = sk(ns);
      if (tG < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tG);
        cameFrom.set(nk, { p: ck, e: edge });
        push(tG + heur(edge.to), ns);
      }
    }
  }
  return {
    found: false, exp, reason: 'exhausted', maxChainSize,
    uniqueStateKeys: gScore.size, deadEndEscapes, peakQueueSize,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };
}

// --- Build test pairs at various distances ---
const wellConnected: { id: number; count: number; lat: number; lng: number }[] = [];
for (const [id, edges] of adjacency) {
  if (edges.length >= 4) {
    const n = nodes.get(id);
    if (n) wellConnected.push({ id, count: edges.length, lat: n.lat, lng: n.lng });
  }
}
console.log(`Well-connected nodes (4+ edges): ${wellConnected.length}\n`);

const STATE_LIMIT = 5_000_000;

// Test 1: Close pairs (100-400m) with 5M limit
console.log(`=== Close pairs (100-400m) — ${(STATE_LIMIT/1e6)}M state limit ===`);
let found1 = 0, total1 = 0;
for (let i = 0; i < wellConnected.length && total1 < 10; i++) {
  for (let j = i + 1; j < wellConnected.length && total1 < 10; j++) {
    const a = wellConnected[i], b = wellConnected[j];
    const straight = hav(a, b);
    if (straight < 100 || straight > 400) continue;
    total1++;
    const t = Date.now();
    const r = runExtreme(a.id, b.id, STATE_LIMIT);
    const ms = Date.now() - t;
    const status = r.found ? 'FOUND' : `FAIL(${r.reason})`;
    const mult = r.found ? ((r.dist! / straight).toFixed(1) + 'x') : '-';
    console.log(`#${total1} ${status} straight=${Math.round(straight)}m dist=${r.dist ?? '-'}m mult=${mult} explored=${r.exp} chain=${r.maxChainSize} keys=${r.gScore?.size ?? r.uniqueStateKeys} deadEnds=${r.deadEndEscapes} queue=${r.peakQueueSize} mem=${r.memoryMB}MB ${ms}ms`);
    if (r.found) found1++;
  }
}
console.log(`\n${found1}/${total1} found (close)\n`);

// Test 2: Medium pairs (400-800m) with 5M limit
console.log(`=== Medium pairs (400-800m) — ${(STATE_LIMIT/1e6)}M state limit ===`);
let found2 = 0, total2 = 0;
for (let i = 0; i < wellConnected.length && total2 < 5; i++) {
  for (let j = i + 1; j < wellConnected.length && total2 < 5; j++) {
    const a = wellConnected[i], b = wellConnected[j];
    const straight = hav(a, b);
    if (straight < 400 || straight > 800) continue;
    total2++;
    const t = Date.now();
    const r = runExtreme(a.id, b.id, STATE_LIMIT);
    const ms = Date.now() - t;
    const status = r.found ? 'FOUND' : `FAIL(${r.reason})`;
    const mult = r.found ? ((r.dist! / straight).toFixed(1) + 'x') : '-';
    console.log(`#${total2} ${status} straight=${Math.round(straight)}m dist=${r.dist ?? '-'}m mult=${mult} explored=${r.exp} chain=${r.maxChainSize} keys=${r.uniqueStateKeys} deadEnds=${r.deadEndEscapes} queue=${r.peakQueueSize} mem=${r.memoryMB}MB ${ms}ms`);
    if (r.found) found2++;
  }
}
console.log(`\n${found2}/${total2} found (medium)\n`);

// Test 3: State space analysis — run one medium pair to exhaustion or 2M and analyze
console.log(`=== State space analysis on one medium pair ===`);
const pair = (() => {
  for (let i = 0; i < wellConnected.length; i++) {
    for (let j = i + 1; j < wellConnected.length; j++) {
      const straight = hav(wellConnected[i], wellConnected[j]);
      if (straight >= 500 && straight <= 600) return [wellConnected[i], wellConnected[j]];
    }
  }
  return null;
})();

if (pair) {
  const [a, b] = pair;
  const straight = Math.round(hav(a, b));
  console.log(`Pair: node ${a.id} → ${b.id}, straight=${straight}m`);

  // Run with checkpoints
  for (const limit of [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000]) {
    const t = Date.now();
    const r = runExtreme(a.id, b.id, limit);
    const ms = Date.now() - t;
    const label = r.found ? `FOUND dist=${r.dist}m` : `FAIL(${r.reason})`;
    console.log(`  limit=${(limit/1e6).toFixed(1)}M: ${label} explored=${r.exp} keys=${r.uniqueStateKeys} chain=${r.maxChainSize} deadEnds=${r.deadEndEscapes} mem=${r.memoryMB}MB ${ms}ms`);
    if (r.found) break;
  }
}
