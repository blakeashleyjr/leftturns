#!/usr/bin/env tsx
/**
 * Test different state key strategies for EXTREME mode.
 * Goal: find the sweet spot between too much dedup (loses path info)
 * and too little dedup (state explosion).
 */
import { readFileSync, readdirSync } from 'fs';
import { unpack } from 'msgpackr';
import { gunzipSync } from 'zlib';

const dir = 'static/demo-tiles';
const files = readdirSync(dir).filter(f => f.endsWith('.bin.gz'));
const tiles = files.map(f => unpack(gunzipSync(readFileSync(`${dir}/${f}`))));

const nodes = new Map<number, { id: number; lat: number; lng: number }>();
const adjacency = new Map<number, any[]>();
for (const tile of tiles) {
  for (const n of tile.nodes) { if (!nodes.has(n.id)) nodes.set(n.id, n); }
  for (const e of tile.edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e);
  }
}

function turnAngle(i: number, o: number) { return ((o - i) % 360 + 360) % 360; }
function isLeftTurn(i: number, o: number) { const a = turnAngle(i, o); return a >= 210 && a <= 340; }
function isTurnAllowed(i: number, o: number) {
  const a = turnAngle(i, o);
  return (a <= 20 || a >= 340) || (a >= 210 && a < 340);
}
function bToBucket(d: number) { return Math.round(((d % 360 + 360) % 360) / 5) % 72; }
function bucketToB(b: number) { return b * 5; }
function hav(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

interface Chain { from: number; to: number; parent: Chain | null; hash: number; size: number }
function chainHas(c: Chain | null, f: number, t: number): boolean {
  while (c) { if (c.from === f && c.to === t) return true; c = c.parent; }
  return false;
}
function chainAdd(c: Chain | null, f: number, t: number): Chain {
  const h = (((f * 2654435761) ^ (t * 2246822519)) >>> 0);
  return { from: f, to: t, parent: c, hash: ((c?.hash ?? 0) + h) >>> 0, size: (c?.size ?? 0) + 1 };
}

// Capped chain: drops oldest entry when size exceeds cap
function chainAddCapped(c: Chain | null, f: number, t: number, cap: number): Chain {
  if (c && c.size >= cap) {
    // Rebuild chain without the oldest entry (walk to end, skip last, rebuild)
    const entries: { from: number; to: number }[] = [];
    let cur = c;
    while (cur) { entries.unshift({ from: cur.from, to: cur.to }); cur = cur.parent; }
    // Drop oldest (first entry)
    entries.shift();
    entries.push({ from: f, to: t });
    // Rebuild
    let result: Chain | null = null;
    for (const e of entries) {
      result = chainAdd(result, e.from, e.to);
    }
    return result!;
  }
  return chainAdd(c, f, t);
}

type StateKeyFn = (nodeId: number, bearingBucket: number, chain: Chain | null) => string;

interface RunResult {
  found: boolean;
  exp: number;
  dist?: number;
  keys: number;
  maxChain: number;
  memMB: number;
  ms: number;
}

function runExtreme(
  startId: number,
  endId: number,
  stateLimit: number,
  keyFn: StateKeyFn,
  chainCap: number = Infinity,
  maxDistFactor: number = Infinity,
): RunResult {
  const startTime = Date.now();
  const endN = nodes.get(endId)!;
  const startN = nodes.get(startId)!;
  const straightDist = hav(startN, endN);
  const maxDist = straightDist * maxDistFactor;
  const heur = (id: number) => { const n = nodes.get(id); return n ? hav(n, endN) : 999999; };

  const heap: { p: number; v: { n: number; b: number; c: Chain | null } }[] = [];
  function push(p: number, v: { n: number; b: number; c: Chain | null }) {
    heap.push({ p, v }); let i = heap.length - 1;
    while (i > 0) { const pi = Math.floor((i - 1) / 2); if (heap[pi].p <= heap[i].p) break; [heap[pi], heap[i]] = [heap[i], heap[pi]]; i = pi; }
  }
  function pop() {
    if (!heap.length) return null; const t = heap[0]; const l = heap.pop()!;
    if (heap.length > 0) { heap[0] = l; let i = 0; while (true) { let s = i, a = 2 * i + 1, b = 2 * i + 2; if (a < heap.length && heap[a].p < heap[s].p) s = a; if (b < heap.length && heap[b].p < heap[s].p) s = b; if (s === i) break; [heap[i], heap[s]] = [heap[s], heap[i]]; i = s; } }
    return t.v;
  }

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, { p: string; e: any }>();

  const s0 = { n: startId, b: -1, c: null as Chain | null };
  const k0 = keyFn(s0.n, s0.b, s0.c);
  gScore.set(k0, 0);
  push(heur(startId), s0);
  let exp = 0, maxChain = 0;
  const DEAD_END_PENALTY = 5;

  while (heap.length > 0) {
    const cur = pop()!;
    const ck = keyFn(cur.n, cur.b, cur.c);
    exp++;
    if (cur.c && cur.c.size > maxChain) maxChain = cur.c.size;

    if (exp > stateLimit) {
      return { found: false, exp, keys: gScore.size, maxChain, memMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), ms: Date.now() - startTime };
    }

    if (cur.n === endId) {
      let dist = 0, k = ck;
      while (cameFrom.has(k)) { const { p, e } = cameFrom.get(k)!; dist += e.dist; k = p; }
      return { found: true, exp, dist: Math.round(dist), keys: gScore.size, maxChain, memMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), ms: Date.now() - startTime };
    }

    const cG = gScore.get(ck) ?? Infinity;

    // Distance pruning
    if (maxDistFactor < Infinity && cG > maxDist) continue;

    const allE = adjacency.get(cur.n) ?? [];
    let allowed: any[];
    let deadEnd = false;

    if (cur.b < 0) {
      allowed = allE;
    } else {
      const inc = bucketToB(cur.b);
      const fl = allE.filter((e: any) => isLeftTurn(inc, e.exitBearing) && !chainHas(cur.c, e.from, e.to));
      if (fl.length > 0) { allowed = fl; }
      else { allowed = allE.filter((e: any) => isTurnAllowed(inc, e.exitBearing)); }
      if (allowed.length === 0 && allE.length > 0) { allowed = allE; deadEnd = true; }
    }

    for (const edge of allowed) {
      const penalty = deadEnd ? DEAD_END_PENALTY : 1;
      const tG = cG + edge.dist * penalty;
      const nb = bToBucket(edge.entryBearing);
      let nc = cur.c;
      if (cur.b >= 0 && isLeftTurn(bucketToB(cur.b), edge.exitBearing)) {
        nc = chainCap < Infinity
          ? chainAddCapped(cur.c, edge.from, edge.to, chainCap)
          : chainAdd(cur.c, edge.from, edge.to);
      }
      const nk = keyFn(edge.to, nb, nc);
      if (tG < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tG);
        cameFrom.set(nk, { p: ck, e: edge });
        push(tG + heur(edge.to), { n: edge.to, b: nb, c: nc });
      }
    }
  }
  return { found: false, exp, keys: gScore.size, maxChain, memMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), ms: Date.now() - startTime, reason: 'exhausted' } as any;
}

// --- Test pairs ---
const wellConnected: { id: number; lat: number; lng: number }[] = [];
for (const [id, edges] of adjacency) {
  if (edges.length >= 4) {
    const n = nodes.get(id);
    if (n) wellConnected.push({ id, lat: n.lat, lng: n.lng });
  }
}

// Collect test pairs at various distances
interface TestPair { a: typeof wellConnected[0]; b: typeof wellConnected[0]; straight: number }
const closePairs: TestPair[] = [];
const medPairs: TestPair[] = [];
const farPairs: TestPair[] = [];

for (let i = 0; i < wellConnected.length; i++) {
  for (let j = i + 1; j < wellConnected.length; j++) {
    const straight = hav(wellConnected[i], wellConnected[j]);
    if (straight >= 150 && straight <= 400 && closePairs.length < 8)
      closePairs.push({ a: wellConnected[i], b: wellConnected[j], straight });
    if (straight >= 500 && straight <= 800 && medPairs.length < 5)
      medPairs.push({ a: wellConnected[i], b: wellConnected[j], straight });
    if (straight >= 1000 && straight <= 1500 && farPairs.length < 3)
      farPairs.push({ a: wellConnected[i], b: wellConnected[j], straight });
  }
}

const LIMIT = 2_000_000; // Use 2M for faster testing

// --- State key strategies ---
const strategies: { name: string; keyFn: StateKeyFn; chainCap?: number; maxDistFactor?: number }[] = [
  {
    name: 'hash+size (current)',
    keyFn: (n, b, c) => `${n}:${b}:${c?.hash ?? 0}:${c?.size ?? 0}`,
  },
  {
    name: 'hash only (no size)',
    keyFn: (n, b, c) => `${n}:${b}:${c?.hash ?? 0}`,
  },
  {
    name: 'hash 16-bit',
    keyFn: (n, b, c) => `${n}:${b}:${(c?.hash ?? 0) & 0xFFFF}`,
  },
  {
    name: 'hash+size, chain cap 30',
    keyFn: (n, b, c) => `${n}:${b}:${c?.hash ?? 0}:${c?.size ?? 0}`,
    chainCap: 30,
  },
  {
    name: 'no chain (node:bearing only)',
    keyFn: (n, b, _c) => `${n}:${b}`,
  },
  {
    name: 'hash only + dist cap 15x',
    keyFn: (n, b, c) => `${n}:${b}:${c?.hash ?? 0}`,
    maxDistFactor: 15,
  },
];

// --- Run tests ---
const allPairs = [
  ...closePairs.map(p => ({ ...p, label: 'close' })),
  ...medPairs.map(p => ({ ...p, label: 'medium' })),
  ...farPairs.map(p => ({ ...p, label: 'far' })),
];

console.log(`Testing ${allPairs.length} pairs × ${strategies.length} strategies (${LIMIT/1e6}M limit)\n`);

// Header
const colW = 28;
process.stdout.write('pair'.padEnd(20));
for (const s of strategies) process.stdout.write(s.name.padEnd(colW));
console.log();
process.stdout.write(''.padEnd(20));
for (const _ of strategies) process.stdout.write('-'.repeat(colW - 2).padEnd(colW));
console.log();

for (const pair of allPairs) {
  process.stdout.write(`${pair.label} ${Math.round(pair.straight)}m`.padEnd(20));

  for (const strat of strategies) {
    // Force GC between runs if possible
    if (global.gc) global.gc();

    const r = runExtreme(
      pair.a.id, pair.b.id, LIMIT,
      strat.keyFn,
      strat.chainCap ?? Infinity,
      strat.maxDistFactor ?? Infinity,
    );

    let cell: string;
    if (r.found) {
      const mult = (r.dist! / pair.straight).toFixed(1);
      cell = `OK ${mult}x ${(r.exp/1000).toFixed(0)}k ${r.ms}ms`;
    } else {
      cell = `FAIL ${(r.exp/1000).toFixed(0)}k ${r.ms}ms`;
    }
    process.stdout.write(cell.padEnd(colW));
  }
  console.log();
}

console.log('\n=== Summary ===');
for (const strat of strategies) {
  let found = 0;
  const times: number[] = [];
  for (const pair of allPairs) {
    const r = runExtreme(pair.a.id, pair.b.id, LIMIT, strat.keyFn, strat.chainCap ?? Infinity, strat.maxDistFactor ?? Infinity);
    if (r.found) { found++; times.push(r.ms); }
  }
  const avgMs = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  console.log(`${strat.name.padEnd(30)} ${found}/${allPairs.length} found  avg=${avgMs}ms`);
}
