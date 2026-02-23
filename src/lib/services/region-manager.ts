import { TILE_BASE_URL } from '$lib/config';
import type { Region, RegionManifest } from '$lib/pathfinding/types';
import { fetchTiles } from './tile-loader';

let manifestCache: RegionManifest | null = null;

/**
 * Fetch the region manifest.
 */
export async function getRegionManifest(): Promise<RegionManifest> {
	if (manifestCache) return manifestCache;

	const isLocal = TILE_BASE_URL.startsWith('/');
	const url = isLocal
		? `${TILE_BASE_URL}/regions.json`
		: `${TILE_BASE_URL}/regions.json`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch region manifest: ${response.status}`);
	}
	manifestCache = await response.json();
	return manifestCache!;
}

/**
 * Download all tiles for a region.
 */
export async function downloadRegion(
	region: Region,
	onProgress?: (loaded: number, total: number) => void
): Promise<Map<string, ArrayBuffer>> {
	return fetchTiles(region.tiles, onProgress);
}

/**
 * Get list of regions that contain a given point.
 */
export function getRegionsForPoint(
	regions: Region[],
	lat: number,
	lng: number
): Region[] {
	return regions.filter(
		(r) =>
			lng >= r.bounds[0] &&
			lat >= r.bounds[1] &&
			lng <= r.bounds[2] &&
			lat <= r.bounds[3]
	);
}

/**
 * Track which regions have been fully downloaded.
 */
const downloadedRegions = new Set<string>();

export function markRegionDownloaded(regionId: string): void {
	downloadedRegions.add(regionId);
	saveDownloadedRegions();
}

export function isRegionDownloaded(regionId: string): boolean {
	return downloadedRegions.has(regionId);
}

export function getDownloadedRegionIds(): string[] {
	return Array.from(downloadedRegions);
}

function saveDownloadedRegions(): void {
	try {
		localStorage.setItem(
			'leftturns-downloaded-regions',
			JSON.stringify(Array.from(downloadedRegions))
		);
	} catch {
		// Silently fail
	}
}

export function loadDownloadedRegions(): void {
	try {
		const stored = localStorage.getItem('leftturns-downloaded-regions');
		if (stored) {
			const ids = JSON.parse(stored) as string[];
			for (const id of ids) downloadedRegions.add(id);
		}
	} catch {
		// Silently fail
	}
}
