#!/usr/bin/env tsx
/**
 * Extract place names from OSM PBF for offline geocoding.
 *
 * Usage:
 *   pnpm generate-places <input.osm.pbf> <output-dir>
 *
 * Creates per-region gzipped JSON files with place names, types, and coordinates.
 *
 * Dependencies:
 *   npm i osm-pbf-parser through2
 */

import { createReadStream, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

interface Place {
	name: string;
	type: string;
	lat: number;
	lng: number;
	pop?: number;
}

const PLACE_TAGS = new Set([
	'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood',
	'quarter', 'borough', 'municipality',
]);

async function main() {
	const [inputPath, outputDir] = process.argv.slice(2);

	if (!inputPath || !outputDir) {
		console.error('Usage: tsx generate-place-index.ts <input.osm.pbf> <output-dir>');
		process.exit(1);
	}

	mkdirSync(outputDir, { recursive: true });

	let osmPbfParser: any;
	let through2: any;
	try {
		osmPbfParser = (await import('osm-pbf-parser')).default;
		through2 = (await import('through2')).default;
	} catch {
		console.error('Missing dependencies. Install: npm i osm-pbf-parser through2');
		process.exit(1);
	}

	const places: Place[] = [];

	console.log(`Extracting place names from ${inputPath}...`);

	await new Promise<void>((resolve, reject) => {
		const parser = osmPbfParser();
		createReadStream(inputPath)
			.pipe(parser)
			.pipe(
				through2.obj((items: any[], _enc: any, next: () => void) => {
					for (const item of items) {
						if (item.type === 'node' && item.tags) {
							const name = item.tags.name || item.tags['name:en'];
							const place = item.tags.place;

							if (name && place && PLACE_TAGS.has(place)) {
								const pop = parseInt(item.tags.population ?? '0', 10) || undefined;
								places.push({
									name,
									type: place,
									lat: Math.round(item.lat * 1e4) / 1e4,
									lng: Math.round(item.lon * 1e4) / 1e4,
									pop,
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

	console.log(`Found ${places.length.toLocaleString()} places`);

	// Sort by population (descending)
	places.sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0));

	// Write as a single global index (can be split per-region later)
	const data = JSON.stringify(places);
	const compressed = gzipSync(Buffer.from(data));
	const outputFile = join(outputDir, 'global.json.gz');
	writeFileSync(outputFile, compressed);

	console.log(`Wrote ${outputFile} (${(compressed.length / 1024).toFixed(0)} KB, ${places.length} places)`);
}

main().catch(console.error);
