#!/usr/bin/env tsx
/**
 * Final verification of EXTREME mode with 16-bit hash strategy.
 * Tests realistic user-click distances on Portland demo tiles.
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
console.log(`Graph: ${nodes.size} nodes, ${Array.from(adjacency.values()).reduce((a, b) => a + b.length, 0)} edges\n`);

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

const DEAD_END_PENALTY = 5;
const STATE_LIMIT = 5_000_000;

function runExtreme(startId: number, endId: number) {
  const endN = nodes.get(endId)!;
  const heur = (id: number) => { const n = nodes.get(id); return n ? hav(n, endN) : 999999; };

  const heap: { p: number; v: { n: number; b: number; c: Chain | null } }[] = [];
  function push(p: number, v: any) {
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
  // 16-bit hash state key (matches updated astar.ts)
  function sk(n: number, b: number, c: Chain | null) {
    return `${n}:${b}:${(c?.hash ?? 0) & 0xFFFF}`;
  }

  const s0 = { n: startId, b: -1, c: null as Chain | null };
  gScore.set(sk(s0.n, s0.b, s0.c), 0);
  push(heur(startId), s0);
  let exp = 0;

  while (heap.length > 0) {
    const cur = pop()!;
    const ck = sk(cur.n, cur.b, cur.c);
    exp++;
    if (exp > STATE_LIMIT) return { found: false, exp, reason: 'limit' };

    if (cur.n === endId) {
      let dist = 0, k = ck;
      while (cameFrom.has(k)) { const { p, e } = cameFrom.get(k)!; dist += e.dist; k = p; }
      return { found: true, exp, dist: Math.round(dist) };
    }

    const cG = gScore.get(ck) ?? Infinity;
    const allE = adjacency.get(cur.n) ?? [];
    let allowed: any[], deadEnd = false;

    if (cur.b < 0) { allowed = allE; }
    else {
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
        nc = chainAdd(cur.c, edge.from, edge.to);
      }
      const nk = sk(edge.to, nb, nc);
      if (tG < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tG);
        cameFrom.set(nk, { p: ck, e: edge });
        push(tG + heur(edge.to), { n: edge.to, b: nb, c: nc });
      }
    }
  }
  return { found: false, exp, reason: 'exhausted' };
}

// --- Collect varied test pairs ---
const wellConnected: { id: number; lat: number; lng: number }[] = [];
for (const [id, edges] of adjacency) {
  if (edges.length >= 3) {
    const n = nodes.get(id);
    if (n) wellConnected.push({ id, lat: n.lat, lng: n.lng });
  }
}

interface Bucket { min: number; max: number; label: string; pairs: { a: any; b: any; straight: number }[]; max_pairs: number }
const buckets: Bucket[] = [
  { min: 100, max: 300, label: 'close (100-300m)', pairs: [], max_pairs: 10 },
  { min: 300, max: 600, label: 'short (300-600m)', pairs: [], max_pairs: 10 },
  { min: 600, max: 1000, label: 'medium (600m-1km)', pairs: [], max_pairs: 10 },
  { min: 1000, max: 2000, label: 'far (1-2km)', pairs: [], max_pairs: 5 },
];

for (let i = 0; i < wellConnected.length; i++) {
  for (let j = i + 1; j < wellConnected.length; j++) {
    const straight = hav(wellConnected[i], wellConnected[j]);
    for (const bucket of buckets) {
      if (straight >= bucket.min && straight < bucket.max && bucket.pairs.length < bucket.max_pairs) {
        bucket.pairs.push({ a: wellConnected[i], b: wellConnected[j], straight });
      }
    }
  }
}

// --- Run ---
for (const bucket of buckets) {
  console.log(`=== ${bucket.label} (${STATE_LIMIT / 1e6}M limit, 16-bit hash) ===`);
  let found = 0;
  for (let i = 0; i < bucket.pairs.length; i++) {
    const { a, b, straight } = bucket.pairs[i];
    const t = Date.now();
    const r = runExtreme(a.id, b.id);
    const ms = Date.now() - t;
    const status = r.found ? 'FOUND' : `FAIL(${(r as any).reason})`;
    const mult = r.found ? `${((r as any).dist / straight).toFixed(1)}x` : '-';
    const dist = r.found ? `${(r as any).dist}m` : '-';
    console.log(`  #${i + 1} ${status} straight=${Math.round(straight)}m dist=${dist} mult=${mult} explored=${(r.exp / 1000).toFixed(0)}k ${ms}ms`);
    if (r.found) found++;
  }
  console.log(`  >> ${found}/${bucket.pairs.length} found\n`);
}
