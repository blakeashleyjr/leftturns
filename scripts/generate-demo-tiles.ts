#!/usr/bin/env tsx
/**
 * Generate demo routing tiles from real OSM road data.
 * Fetches the Portland, OR road network via Overpass API
 * and writes MessagePack tiles to static/demo-tiles/.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pack } from 'msgpackr';
import { gzipSync } from 'zlib';

const OUTPUT_DIR = join(import.meta.dirname, '..', 'static', 'demo-tiles');

// Portland, OR area — downtown + inner neighborhoods
const BOUNDS = {
	south: 45.49,
	north: 45.56,
	west: -122.72,
	east: -122.62,
};

const ZOOM = 13;

// OSM highway types to include, mapped to road class numbers
const HIGHWAY_CLASSES: Record<string, number> = {
	motorway: 0,
	motorway_link: 0,
	trunk: 1,
	trunk_link: 1,
	primary: 2,
	primary_link: 2,
	secondary: 3,
	secondary_link: 3,
	tertiary: 4,
	tertiary_link: 4,
	unclassified: 5,
	residential: 6,
	living_street: 7,
	service: 7,
};

function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
	const n = 2 ** zoom;
	const x = Math.floor(((lng + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor(
		((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
	);
	return { x, y };
}

function calcBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

interface OsmNode {
	id: number;
	lat: number;
	lon: number;
}

interface OsmWay {
	id: number;
	nodes: number[];
	tags: Record<string, string>;
}

interface OverpassResponse {
	elements: (
		| { type: 'node'; id: number; lat: number; lon: number }
		| { type: 'way'; id: number; nodes: number[]; tags: Record<string, string> }
	)[];
}

interface Node {
	id: number;
	lat: number;
	lng: number;
}

interface Edge {
	from: number;
	to: number;
	dist: number;
	exitBearing: number;
	entryBearing: number;
	roadClass: number;
	geometry: number[];
}

async function fetchOsmData(): Promise<{ nodes: Map<number, OsmNode>; ways: OsmWay[] }> {
	const bbox = `${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`;
	const highwayTypes = Object.keys(HIGHWAY_CLASSES).join('|');

	const query = `
		[out:json][timeout:60];
		(
			way["highway"~"^(${highwayTypes})$"](${bbox});
		);
		out body;
		>;
		out skel qt;
	`;

	console.log('Fetching OSM road data from Overpass API...');
	const response = await fetch('https://overpass-api.de/api/interpreter', {
		method: 'POST',
		body: `data=${encodeURIComponent(query)}`,
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
	});

	if (!response.ok) {
		throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as OverpassResponse;
	console.log(`  Received ${data.elements.length} elements from Overpass`);

	const nodes = new Map<number, OsmNode>();
	const ways: OsmWay[] = [];

	for (const el of data.elements) {
		if (el.type === 'node') {
			nodes.set(el.id, { id: el.id, lat: el.lat, lon: el.lon });
		} else if (el.type === 'way') {
			ways.push({ id: el.id, nodes: el.nodes, tags: el.tags ?? {} });
		}
	}

	console.log(`  Nodes: ${nodes.size}, Ways: ${ways.length}`);
	return { nodes, ways };
}

/**
 * Find intersection nodes — nodes that appear in 2+ ways, or are way endpoints.
 * These become the routing graph nodes. Intermediate nodes become edge geometry.
 */
function findIntersections(ways: OsmWay[]): Set<number> {
	const nodeCounts = new Map<number, number>();

	for (const way of ways) {
		for (const nodeId of way.nodes) {
			nodeCounts.set(nodeId, (nodeCounts.get(nodeId) ?? 0) + 1);
		}
		// Way endpoints are always intersections
		if (way.nodes.length > 0) {
			nodeCounts.set(way.nodes[0], (nodeCounts.get(way.nodes[0]) ?? 0) + 10);
			nodeCounts.set(
				way.nodes[way.nodes.length - 1],
				(nodeCounts.get(way.nodes[way.nodes.length - 1]) ?? 0) + 10
			);
		}
	}

	const intersections = new Set<number>();
	for (const [nodeId, count] of nodeCounts) {
		if (count >= 2) {
			intersections.add(nodeId);
		}
	}
	return intersections;
}

async function main() {
	mkdirSync(OUTPUT_DIR, { recursive: true });

	const { nodes: osmNodes, ways } = await fetchOsmData();

	// Find intersection nodes
	const intersections = findIntersections(ways);
	console.log(`  Intersection nodes: ${intersections.size}`);

	// Build routing graph: split ways at intersections into edges
	const graphNodes = new Map<number, Node>();
	const edges: Edge[] = [];

	for (const way of ways) {
		const highway = way.tags.highway ?? '';
		const roadClass = HIGHWAY_CLASSES[highway] ?? 6;
		const isOneway =
			way.tags.oneway === 'yes' ||
			way.tags.oneway === '1' ||
			way.tags.junction === 'roundabout';
		const isReverseOneway = way.tags.oneway === '-1';

		// Split this way into segments between intersection nodes
		let segStart = 0;
		for (let i = 0; i < way.nodes.length; i++) {
			const nodeId = way.nodes[i];
			const isIntersection = intersections.has(nodeId);
			const isEnd = i === way.nodes.length - 1;

			if ((isIntersection || isEnd) && i > segStart) {
				// Build an edge from way.nodes[segStart] to way.nodes[i]
				const fromOsm = osmNodes.get(way.nodes[segStart]);
				const toOsm = osmNodes.get(nodeId);
				if (!fromOsm || !toOsm) {
					segStart = i;
					continue;
				}

				// Collect intermediate geometry
				const geomPoints: { lat: number; lng: number }[] = [];
				let totalDist = 0;
				for (let j = segStart; j <= i; j++) {
					const n = osmNodes.get(way.nodes[j]);
					if (n) {
						if (geomPoints.length > 0) {
							const prev = geomPoints[geomPoints.length - 1];
							totalDist += haversineMeters(prev.lat, prev.lng, n.lat, n.lon);
						}
						geomPoints.push({ lat: n.lat, lng: n.lon });
					}
				}

				if (geomPoints.length < 2 || totalDist < 1) {
					segStart = i;
					continue;
				}

				// Flatten geometry
				const flatGeom: number[] = [];
				for (const p of geomPoints) {
					flatGeom.push(p.lat, p.lng);
				}

				const first = geomPoints[0];
				const second = geomPoints[1];
				const secondLast = geomPoints[geomPoints.length - 2];
				const last = geomPoints[geomPoints.length - 1];

				const exitBearing = calcBearing(first.lat, first.lng, second.lat, second.lng);
				const entryBearing = calcBearing(secondLast.lat, secondLast.lng, last.lat, last.lng);

				// Add graph nodes
				graphNodes.set(way.nodes[segStart], {
					id: way.nodes[segStart],
					lat: first.lat,
					lng: first.lng,
				});
				graphNodes.set(nodeId, {
					id: nodeId,
					lat: last.lat,
					lng: last.lng,
				});

				// Forward edge
				if (!isReverseOneway) {
					edges.push({
						from: way.nodes[segStart],
						to: nodeId,
						dist: Math.round(totalDist),
						exitBearing: Math.round(exitBearing * 10) / 10,
						entryBearing: Math.round(entryBearing * 10) / 10,
						roadClass,
						geometry: flatGeom,
					});
				}

				// Reverse edge (if not one-way)
				if (!isOneway && !isReverseOneway) {
					const revGeom: number[] = [];
					for (let j = geomPoints.length - 1; j >= 0; j--) {
						revGeom.push(geomPoints[j].lat, geomPoints[j].lng);
					}

					const revExitBearing = calcBearing(last.lat, last.lng, secondLast.lat, secondLast.lng);
					const revEntryBearing = calcBearing(second.lat, second.lng, first.lat, first.lng);

					edges.push({
						from: nodeId,
						to: way.nodes[segStart],
						dist: Math.round(totalDist),
						exitBearing: Math.round(revExitBearing * 10) / 10,
						entryBearing: Math.round(revEntryBearing * 10) / 10,
						roadClass,
						geometry: revGeom,
					});
				}

				// Reverse one-way: edge goes in reverse direction only
				if (isReverseOneway) {
					const revGeom: number[] = [];
					for (let j = geomPoints.length - 1; j >= 0; j--) {
						revGeom.push(geomPoints[j].lat, geomPoints[j].lng);
					}

					const revExitBearing = calcBearing(last.lat, last.lng, secondLast.lat, secondLast.lng);
					const revEntryBearing = calcBearing(second.lat, second.lng, first.lat, first.lng);

					edges.push({
						from: nodeId,
						to: way.nodes[segStart],
						dist: Math.round(totalDist),
						exitBearing: Math.round(revExitBearing * 10) / 10,
						entryBearing: Math.round(revEntryBearing * 10) / 10,
						roadClass,
						geometry: revGeom,
					});
				}

				segStart = i;
			}
		}
	}

	console.log(`  Graph nodes: ${graphNodes.size}`);
	console.log(`  Graph edges: ${edges.length}`);

	// Tile the data at z13
	const tileMap = new Map<
		string,
		{
			nodes: Map<number, Node>;
			edges: Edge[];
			borderNodes: Set<number>;
		}
	>();

	function tileKey(lat: number, lng: number): string {
		const { x, y } = latLngToTile(lat, lng, ZOOM);
		return `${ZOOM}-${x}-${y}`;
	}

	function ensureTile(key: string) {
		let tile = tileMap.get(key);
		if (!tile) {
			tile = { nodes: new Map(), edges: [], borderNodes: new Set() };
			tileMap.set(key, tile);
		}
		return tile;
	}

	for (const edge of edges) {
		const fromNode = graphNodes.get(edge.from)!;
		const toNode = graphNodes.get(edge.to)!;
		if (!fromNode || !toNode) continue;

		const fromTileKey = tileKey(fromNode.lat, fromNode.lng);
		const toTileKey = tileKey(toNode.lat, toNode.lng);

		const tile = ensureTile(fromTileKey);
		tile.nodes.set(edge.from, fromNode);
		tile.nodes.set(edge.to, toNode);
		tile.edges.push(edge);

		if (fromTileKey !== toTileKey) {
			tile.borderNodes.add(edge.to);
			const otherTile = ensureTile(toTileKey);
			otherTile.nodes.set(edge.from, fromNode);
			otherTile.nodes.set(edge.to, toNode);
			otherTile.borderNodes.add(edge.from);
			otherTile.borderNodes.add(edge.to);
		}
	}

	console.log(`  Tiles: ${tileMap.size}`);

	// Write tiles as gzipped MessagePack
	let totalBytes = 0;
	const tileKeys: string[] = [];

	for (const [key, tile] of tileMap) {
		const tileData = {
			nodes: Array.from(tile.nodes.values()).map((n) => ({
				id: n.id,
				lat: Math.round(n.lat * 1e7) / 1e7,
				lng: Math.round(n.lng * 1e7) / 1e7,
			})),
			edges: tile.edges.map((e) => ({
				from: e.from,
				to: e.to,
				dist: e.dist,
				exitBearing: e.exitBearing,
				entryBearing: e.entryBearing,
				roadClass: e.roadClass,
				geometry: e.geometry.map((v) => Math.round(v * 1e7) / 1e7),
			})),
			borderNodes: Array.from(tile.borderNodes),
		};

		const packed = pack(tileData);
		const compressed = gzipSync(packed);
		writeFileSync(join(OUTPUT_DIR, `${key}.bin.gz`), compressed);
		totalBytes += compressed.length;
		tileKeys.push(key);
	}

	// Write regions manifest
	const manifest = {
		regions: [
			{
				id: 'demo-portland',
				name: 'Portland Demo Area',
				bounds: [BOUNDS.west, BOUNDS.south, BOUNDS.east, BOUNDS.north],
				tiles: tileKeys,
				totalSize: totalBytes,
				nodeCount: graphNodes.size,
			},
		],
	};
	writeFileSync(join(OUTPUT_DIR, 'regions.json'), JSON.stringify(manifest, null, 2));

	// Write place index
	const places = [
		{ name: 'Portland', type: 'city', lat: 45.5231, lng: -122.6765, pop: 652503 },
		{ name: 'Pearl District', type: 'neighbourhood', lat: 45.5288, lng: -122.6834 },
		{ name: 'Hawthorne', type: 'neighbourhood', lat: 45.5118, lng: -122.6306 },
		{ name: 'Alberta Arts District', type: 'neighbourhood', lat: 45.5589, lng: -122.6468 },
		{ name: 'Burnside', type: 'neighbourhood', lat: 45.5231, lng: -122.6765 },
		{ name: 'Lloyd District', type: 'neighbourhood', lat: 45.5312, lng: -122.6587 },
		{ name: 'Sellwood', type: 'neighbourhood', lat: 45.4644, lng: -122.6536 },
		{ name: 'Division Street', type: 'neighbourhood', lat: 45.5048, lng: -122.6358 },
	];
	writeFileSync(join(OUTPUT_DIR, 'places.json'), JSON.stringify(places));

	console.log(`\nTotal tile size: ${(totalBytes / 1024).toFixed(1)} KB`);
	console.log(`Output: ${OUTPUT_DIR}`);
	console.log('Done!');
}

main().catch((err) => {
	console.error('Failed:', err);
	process.exit(1);
});
