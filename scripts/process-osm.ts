#!/usr/bin/env tsx
/**
 * Process OSM PBF file into z13 routing tiles (gzipped MessagePack).
 *
 * Usage:
 *   pnpm process-osm <input.osm.pbf> <output-dir>
 *
 * This script:
 * 1. Streams through the PBF file
 * 2. Extracts drivable roads (ways with highway=*)
 * 3. Builds a graph with intersection detection
 * 4. Computes bearings for each edge
 * 5. Tiles the graph spatially at z13
 * 6. Writes gzipped MessagePack per tile
 *
 * Dependencies (install before running):
 *   npm i osm-pbf-parser through2 msgpackr
 */

import { createReadStream, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { pack } from 'msgpackr';

// Lazy imports — these are heavy and optional for the app itself
const DRIVABLE_HIGHWAY_TAGS = new Set([
	'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
	'unclassified', 'residential', 'motorway_link', 'trunk_link',
	'primary_link', 'secondary_link', 'tertiary_link', 'living_street',
	'service',
]);

const ROAD_CLASS_MAP: Record<string, number> = {
	motorway: 0, motorway_link: 0,
	trunk: 1, trunk_link: 1,
	primary: 2, primary_link: 2,
	secondary: 3, secondary_link: 3,
	tertiary: 4, tertiary_link: 4,
	unclassified: 5,
	residential: 6,
	living_street: 7,
	service: 7,
};

interface RawNode {
	lat: number;
	lng: number;
}

interface RawWay {
	nodeRefs: number[];
	highway: string;
	oneway: boolean;
}

function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
	const n = 2 ** zoom;
	const x = Math.floor(((lng + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
	return { x, y };
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const toRad = Math.PI / 180;
	const dLng = (lng2 - lng1) * toRad;
	const y = Math.sin(dLng) * Math.cos(lat2 * toRad);
	const x =
		Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
		Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLng);
	const b = Math.atan2(y, x) * (180 / Math.PI);
	return ((b % 360) + 360) % 360;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371000;
	const toRad = Math.PI / 180;
	const dLat = (lat2 - lat1) * toRad;
	const dLng = (lng2 - lng1) * toRad;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main() {
	const [inputPath, outputDir] = process.argv.slice(2);

	if (!inputPath || !outputDir) {
		console.error('Usage: tsx process-osm.ts <input.osm.pbf> <output-dir>');
		process.exit(1);
	}

	console.log(`Processing ${inputPath} → ${outputDir}`);
	mkdirSync(outputDir, { recursive: true });

	// Phase 1: Read PBF and collect nodes + ways
	console.log('Phase 1: Reading PBF...');

	let osmPbfParser: any;
	let through2: any;
	try {
		osmPbfParser = (await import('osm-pbf-parser')).default;
		through2 = (await import('through2')).default;
	} catch {
		console.error('Missing dependencies. Install: npm i osm-pbf-parser through2');
		process.exit(1);
	}

	const nodes = new Map<number, RawNode>();
	const ways: RawWay[] = [];

	await new Promise<void>((resolve, reject) => {
		const parser = osmPbfParser();
		createReadStream(inputPath)
			.pipe(parser)
			.pipe(
				through2.obj((items: any[], _enc: any, next: () => void) => {
					for (const item of items) {
						if (item.type === 'node') {
							nodes.set(item.id, { lat: item.lat, lng: item.lon });
						} else if (item.type === 'way' && item.tags?.highway) {
							const highway = item.tags.highway;
							if (DRIVABLE_HIGHWAY_TAGS.has(highway)) {
								ways.push({
									nodeRefs: item.refs,
									highway,
									oneway:
										item.tags.oneway === 'yes' ||
										item.tags.oneway === '1' ||
										item.tags.junction === 'roundabout' ||
										highway === 'motorway',
								});
							}
						}
					}
					next();
				})
			)
			.on('finish', resolve)
			.on('error', reject);
	});

	console.log(`  Nodes: ${nodes.size.toLocaleString()}`);
	console.log(`  Ways: ${ways.length.toLocaleString()}`);

	// Phase 2: Find intersections (nodes referenced by 2+ ways)
	console.log('Phase 2: Finding intersections...');
	const nodeRefCount = new Map<number, number>();
	for (const way of ways) {
		for (const ref of way.nodeRefs) {
			nodeRefCount.set(ref, (nodeRefCount.get(ref) ?? 0) + 1);
		}
	}

	// Endpoints of ways are always graph nodes
	for (const way of ways) {
		nodeRefCount.set(way.nodeRefs[0], 2);
		nodeRefCount.set(way.nodeRefs[way.nodeRefs.length - 1], 2);
	}

	const intersections = new Set<number>();
	for (const [id, count] of nodeRefCount) {
		if (count >= 2) intersections.add(id);
	}
	console.log(`  Intersections: ${intersections.size.toLocaleString()}`);

	// Phase 3: Build edges between intersections
	console.log('Phase 3: Building edges...');

	interface Edge {
		from: number;
		to: number;
		dist: number;
		exitBearing: number;
		entryBearing: number;
		roadClass: number;
		geometry: number[]; // flat [lat, lng, ...]
	}

	const edges: Edge[] = [];
	const graphNodes = new Set<number>();

	for (const way of ways) {
		const refs = way.nodeRefs;
		let segStart = 0;

		for (let i = 1; i < refs.length; i++) {
			if (i === refs.length - 1 || intersections.has(refs[i])) {
				// Build edge from refs[segStart] to refs[i]
				const fromId = refs[segStart];
				const toId = refs[i];

				const fromNode = nodes.get(fromId);
				const toNode = nodes.get(toId);
				if (!fromNode || !toNode) {
					segStart = i;
					continue;
				}

				// Collect geometry and compute distance
				let dist = 0;
				const geometry: number[] = [];
				let prevNode = fromNode;
				geometry.push(fromNode.lat, fromNode.lng);

				for (let j = segStart + 1; j <= i; j++) {
					const n = nodes.get(refs[j]);
					if (!n) continue;
					dist += haversineMeters(prevNode.lat, prevNode.lng, n.lat, n.lng);
					geometry.push(n.lat, n.lng);
					prevNode = n;
				}

				// Compute bearings
				const nextAfterFrom = nodes.get(refs[segStart + 1]) ?? toNode;
				const prevBeforeTo = nodes.get(refs[i - 1]) ?? fromNode;

				const exitBearing = bearing(fromNode.lat, fromNode.lng, nextAfterFrom.lat, nextAfterFrom.lng);
				const entryBearing = bearing(prevBeforeTo.lat, prevBeforeTo.lng, toNode.lat, toNode.lng);

				const roadClass = ROAD_CLASS_MAP[way.highway] ?? 7;

				graphNodes.add(fromId);
				graphNodes.add(toId);

				// Forward edge
				edges.push({ from: fromId, to: toId, dist, exitBearing, entryBearing, roadClass, geometry });

				// Reverse edge (if not oneway)
				if (!way.oneway) {
					const revGeometry = [...geometry].reverse();
					// Reverse pairs: [lat1,lng1,lat2,lng2] → [lat2,lng2,lat1,lng1]
					const revGeomFixed: number[] = [];
					for (let g = geometry.length - 2; g >= 0; g -= 2) {
						revGeomFixed.push(geometry[g], geometry[g + 1]);
					}

					edges.push({
						from: toId,
						to: fromId,
						dist,
						exitBearing: (entryBearing + 180) % 360,
						entryBearing: (exitBearing + 180) % 360,
						roadClass,
						geometry: revGeomFixed,
					});
				}

				segStart = i;
			}
		}
	}

	console.log(`  Graph nodes: ${graphNodes.size.toLocaleString()}`);
	console.log(`  Edges: ${edges.length.toLocaleString()}`);

	// Phase 4: Tile spatially at z13
	console.log('Phase 4: Tiling at z13...');
	const zoom = 13;

	interface TileData {
		nodes: Map<number, { lat: number; lng: number }>;
		edges: Edge[];
		borderNodes: Set<number>;
	}

	const tileMap = new Map<string, TileData>();

	function getTileKey(lat: number, lng: number): string {
		const { x, y } = latLngToTile(lat, lng, zoom);
		return `${zoom}-${x}-${y}`;
	}

	function ensureTile(key: string): TileData {
		let tile = tileMap.get(key);
		if (!tile) {
			tile = { nodes: new Map(), edges: [], borderNodes: new Set() };
			tileMap.set(key, tile);
		}
		return tile;
	}

	for (const edge of edges) {
		const fromNode = nodes.get(edge.from)!;
		const toNode = nodes.get(edge.to)!;
		const fromTile = getTileKey(fromNode.lat, fromNode.lng);
		const toTile = getTileKey(toNode.lat, toNode.lng);

		// Add edge to the tile of its 'from' node
		const tile = ensureTile(fromTile);
		tile.nodes.set(edge.from, { lat: fromNode.lat, lng: fromNode.lng });
		tile.nodes.set(edge.to, { lat: toNode.lat, lng: toNode.lng });
		tile.edges.push(edge);

		// If edge crosses tile boundary, mark border nodes
		if (fromTile !== toTile) {
			tile.borderNodes.add(edge.to);
			const otherTile = ensureTile(toTile);
			otherTile.nodes.set(edge.from, { lat: fromNode.lat, lng: fromNode.lng });
			otherTile.nodes.set(edge.to, { lat: toNode.lat, lng: toNode.lng });
			otherTile.borderNodes.add(edge.from);
			otherTile.borderNodes.add(edge.to);
		}
	}

	console.log(`  Tiles: ${tileMap.size.toLocaleString()}`);

	// Phase 5: Write tiles as gzipped MessagePack
	console.log('Phase 5: Writing tiles...');
	let totalBytes = 0;

	for (const [key, tile] of tileMap) {
		const tileData = {
			nodes: Array.from(tile.nodes.entries()).map(([id, n]) => ({
				id,
				lat: Math.round(n.lat * 1e6) / 1e6,
				lng: Math.round(n.lng * 1e6) / 1e6,
			})),
			edges: tile.edges.map((e) => ({
				from: e.from,
				to: e.to,
				dist: Math.round(e.dist),
				exitBearing: Math.round(e.exitBearing * 10) / 10,
				entryBearing: Math.round(e.entryBearing * 10) / 10,
				roadClass: e.roadClass,
				geometry: e.geometry.map((v) => Math.round(v * 1e6) / 1e6),
			})),
			borderNodes: Array.from(tile.borderNodes),
		};

		const packed = pack(tileData);
		const compressed = gzipSync(packed);
		const filename = `${key}.bin.gz`;
		writeFileSync(join(outputDir, filename), compressed);
		totalBytes += compressed.length;
	}

	console.log(`  Total size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
	console.log('Done!');
}

main().catch(console.error);
