#!/usr/bin/env tsx
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
function isTurnAllowed(i: number, o: number) { const a = turnAngle(i, o); return a <= 20 || a >= 210; }
function bToBucket(d: number) { return Math.round(((d % 360 + 360) % 360) / 5) % 72; }
function bucketToB(b: number) { return b * 5; }

// Find a well-connected node in downtown Portland
const wellConnected: any[] = [];
for (const [id, edges] of adjacency) {
  if (edges.length >= 4) {
    const n = nodes.get(id);
    if (n && n.lat > 45.52 && n.lat < 45.54 && n.lng > -122.69 && n.lng < -122.67) {
      wellConnected.push({ id, count: edges.length, ...n });
    }
  }
}
wellConnected.sort((a, b) => b.count - a.count);

const start = wellConnected[0];
console.log(`Start: node ${start.id} (${start.lat}, ${start.lng}) edges=${start.count}`);

// Trace the EXTREME path step by step
interface Chain { from: number; to: number; parent: Chain | null }
function chainHas(c: Chain | null, f: number, t: number): boolean {
  while (c) { if (c.from === f && c.to === t) return true; c = c.parent; }
  return false;
}

let pos = start.id;
let bucket = -1;
let used: Chain | null = null;
let totalDist = 0;
const visited = new Set<string>();

for (let step = 0; step < 60; step++) {
  const n = nodes.get(pos)!;
  const allEdges = adjacency.get(pos) ?? [];
  const stateStr = `${pos}:${bucket}`;

  let allowed: any[];
  let reason: string;

  if (bucket < 0) {
    // Start: pick the edge closest to east (toward destination)
    allowed = allEdges;
    reason = 'start (all)';
  } else {
    const inc = bucketToB(bucket);
    const freshLefts = allEdges.filter((e: any) => isLeftTurn(inc, e.exitBearing) && !chainHas(used, e.from, e.to));
    const noRight = allEdges.filter((e: any) => isTurnAllowed(inc, e.exitBearing));

    if (freshLefts.length > 0) {
      allowed = freshLefts;
      reason = `FORCED LEFT (${freshLefts.length} options, ${noRight.length} total no-right)`;
    } else {
      allowed = noRight;
      reason = `freed (${noRight.length} no-right options)`;
    }
  }

  const toStr = (e: any) => {
    const tn = nodes.get(e.to);
    const angle = bucket >= 0 ? turnAngle(bucketToB(bucket), e.exitBearing).toFixed(0) : '-';
    return `→${e.to} bearing=${e.exitBearing.toFixed(0)}° angle=${angle}° dist=${e.dist}m`;
  };

  console.log(`\nStep ${step}: node=${pos} bucket=${bucket} (bearing=${bucket >= 0 ? bucketToB(bucket) : '-'}°) totalDist=${totalDist}m`);
  console.log(`  ${reason}`);
  for (const e of allowed) console.log(`  ${toStr(e)}`);

  if (allowed.length === 0) {
    console.log('  DEAD END — no allowed edges!');
    // Show what ALL edges look like
    console.log('  All edges from this node:');
    for (const e of allEdges) {
      const angle = bucket >= 0 ? turnAngle(bucketToB(bucket), e.exitBearing) : -1;
      const isLeft = bucket >= 0 && isLeftTurn(bucketToB(bucket), e.exitBearing);
      const isAllowed = bucket >= 0 && isTurnAllowed(bucketToB(bucket), e.exitBearing);
      const isUsed = chainHas(used, e.from, e.to);
      console.log(`    ${toStr(e)} left=${isLeft} allowed=${isAllowed} used=${isUsed}`);
    }
    break;
  }

  // Take the first allowed edge
  const edge = allowed[0];
  const wasLeft = bucket >= 0 && isLeftTurn(bucketToB(bucket), edge.exitBearing);
  if (wasLeft) {
    used = { from: edge.from, to: edge.to, parent: used };
  }

  totalDist += edge.dist;
  pos = edge.to;
  bucket = bToBucket(edge.entryBearing);

  // Check for revisit
  const newState = `${pos}:${bucket}`;
  if (visited.has(newState)) {
    console.log(`  ** Revisited state ${newState} — would loop`);
  }
  visited.add(newState);
}
