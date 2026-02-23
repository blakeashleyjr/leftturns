#!/usr/bin/env tsx
/**
 * Generate region manifest from processed routing tiles.
 *
 * Usage:
 *   pnpm generate-regions <tiles-dir> <output-file>
 *
 * Scans the tiles directory and creates a regions.json manifest with
 * pre-defined regions at multiple scales (metro, state, country).
 */

import { readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

interface RegionDef {
	id: string;
	name: string;
	bounds: [number, number, number, number]; // [west, south, east, north]
}

// Pre-defined regions (extend as needed)
const REGION_DEFS: RegionDef[] = [
	// Metro areas
	{ id: 'us-portland', name: 'Portland, OR', bounds: [-122.85, 45.40, -122.45, 45.60] },
	{ id: 'us-seattle', name: 'Seattle, WA', bounds: [-122.45, 47.50, -122.20, 47.75] },
	{ id: 'us-sf', name: 'San Francisco Bay Area', bounds: [-122.60, 37.20, -121.70, 37.90] },
	{ id: 'us-la', name: 'Los Angeles', bounds: [-118.70, 33.70, -117.70, 34.35] },
	{ id: 'us-nyc', name: 'New York City', bounds: [-74.30, 40.45, -73.65, 40.95] },
	{ id: 'us-chicago', name: 'Chicago', bounds: [-88.00, 41.60, -87.50, 42.10] },
	{ id: 'us-austin', name: 'Austin, TX', bounds: [-97.95, 30.10, -97.55, 30.55] },
	{ id: 'us-denver', name: 'Denver, CO', bounds: [-105.10, 39.60, -104.80, 39.85] },
	// States
	{ id: 'us-oregon', name: 'Oregon', bounds: [-124.57, 41.99, -116.46, 46.29] },
	{ id: 'us-washington', name: 'Washington', bounds: [-124.85, 45.54, -116.92, 49.00] },
	{ id: 'us-california', name: 'California', bounds: [-124.48, 32.53, -114.13, 42.01] },
	// Countries
	{ id: 'us', name: 'United States', bounds: [-125.00, 24.50, -66.90, 49.50] },
];

function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
	const n = 2 ** zoom;
	const x = Math.floor(((lng + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor(
		((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
	);
	return { x, y };
}

function main() {
	const [tilesDir, outputFile] = process.argv.slice(2);

	if (!tilesDir || !outputFile) {
		console.error('Usage: tsx generate-regions.ts <tiles-dir> <output-file>');
		process.exit(1);
	}

	// Scan tiles directory
	const tileFiles = readdirSync(tilesDir).filter((f) => f.endsWith('.bin.gz'));
	const tileIndex = new Map<string, number>();

	for (const file of tileFiles) {
		const key = file.replace('.bin.gz', '');
		const size = statSync(join(tilesDir, file)).size;
		tileIndex.set(key, size);
	}

	console.log(`Found ${tileIndex.size} tiles`);

	const zoom = 13;
	const regions = [];

	for (const def of REGION_DEFS) {
		const [west, south, east, north] = def.bounds;
		const nw = latLngToTile(north, west, zoom);
		const se = latLngToTile(south, east, zoom);

		const tiles: string[] = [];
		let totalSize = 0;

		for (let x = nw.x; x <= se.x; x++) {
			for (let y = nw.y; y <= se.y; y++) {
				const key = `${zoom}-${x}-${y}`;
				if (tileIndex.has(key)) {
					tiles.push(key);
					totalSize += tileIndex.get(key)!;
				}
			}
		}

		if (tiles.length > 0) {
			regions.push({
				id: def.id,
				name: def.name,
				bounds: def.bounds,
				tiles,
				totalSize,
				nodeCount: 0, // Would need to read tiles to count — placeholder
			});
			console.log(`  ${def.name}: ${tiles.length} tiles, ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
		}
	}

	const manifest = { regions };
	writeFileSync(outputFile, JSON.stringify(manifest, null, 2));
	console.log(`Wrote ${outputFile} with ${regions.length} regions`);
}

main();
