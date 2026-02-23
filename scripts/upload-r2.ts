#!/usr/bin/env tsx
/**
 * Upload routing tiles, region manifest, and place indices to Cloudflare R2.
 *
 * Usage:
 *   pnpm upload-r2 <data-dir>
 *
 * Expects the data directory to contain:
 *   - routing/         (routing tiles: z-x-y.bin.gz)
 *   - regions.json     (region manifest)
 *   - places/          (place indices: region-id.json.gz)
 *
 * Requires wrangler to be configured with R2 bucket access.
 * Uses `wrangler r2 object put` under the hood.
 */

import { readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

const BUCKET = 'leftturns-data';

function uploadFile(localPath: string, remotePath: string, contentType: string) {
	const cmd = `wrangler r2 object put ${BUCKET}/${remotePath} --file=${localPath} --content-type="${contentType}"`;
	try {
		execSync(cmd, { stdio: 'pipe' });
		return true;
	} catch (err) {
		console.error(`  Failed: ${remotePath}`);
		return false;
	}
}

function main() {
	const [dataDir] = process.argv.slice(2);

	if (!dataDir) {
		console.error('Usage: tsx upload-r2.ts <data-dir>');
		process.exit(1);
	}

	let uploaded = 0;
	let failed = 0;

	// Upload routing tiles
	const routingDir = join(dataDir, 'routing');
	if (existsSync(routingDir)) {
		const tiles = readdirSync(routingDir).filter((f) => f.endsWith('.bin.gz'));
		console.log(`Uploading ${tiles.length} routing tiles...`);

		for (const tile of tiles) {
			const localPath = join(routingDir, tile);
			const remotePath = `routing/${tile}`;
			process.stdout.write(`  ${remotePath}\r`);
			if (uploadFile(localPath, remotePath, 'application/octet-stream')) {
				uploaded++;
			} else {
				failed++;
			}
		}
		console.log();
	}

	// Upload region manifest
	const regionsFile = join(dataDir, 'regions.json');
	if (existsSync(regionsFile)) {
		console.log('Uploading regions.json...');
		if (uploadFile(regionsFile, 'regions.json', 'application/json')) {
			uploaded++;
		} else {
			failed++;
		}
	}

	// Upload place indices
	const placesDir = join(dataDir, 'places');
	if (existsSync(placesDir)) {
		const indices = readdirSync(placesDir).filter((f) => f.endsWith('.json.gz'));
		console.log(`Uploading ${indices.length} place indices...`);

		for (const index of indices) {
			const localPath = join(placesDir, index);
			const remotePath = `places/${index}`;
			if (uploadFile(localPath, remotePath, 'application/json')) {
				uploaded++;
			} else {
				failed++;
			}
		}
	}

	console.log(`\nDone: ${uploaded} uploaded, ${failed} failed`);
}

main();
