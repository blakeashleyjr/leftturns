import { ROUTING_TILE_ZOOM, BBOX_PAD_FACTOR } from '$lib/config';

/** Convert lat/lng to tile coordinates at a given zoom level */
export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
	const n = 2 ** zoom;
	const x = Math.floor(((lng + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
	return { x, y };
}

/** Convert tile coordinates back to lat/lng (NW corner) */
export function tileToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
	const n = 2 ** zoom;
	const lng = (x / n) * 360 - 180;
	const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
	const lat = (latRad * 180) / Math.PI;
	return { lat, lng };
}

/** Get tile key string */
export function tileKey(zoom: number, x: number, y: number): string {
	return `${zoom}-${x}-${y}`;
}

/** Parse tile key string */
export function parseTileKey(key: string): { zoom: number; x: number; y: number } {
	const [z, x, y] = key.split('-').map(Number);
	return { zoom: z, x, y };
}

/**
 * Get all z13 tile keys that cover the bounding box between two points,
 * with padding applied.
 */
export function getTilesForBounds(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number
): string[] {
	const south = Math.min(lat1, lat2);
	const north = Math.max(lat1, lat2);
	const west = Math.min(lng1, lng2);
	const east = Math.max(lng1, lng2);

	// Add padding
	const latPad = (north - south) * BBOX_PAD_FACTOR;
	const lngPad = (east - west) * BBOX_PAD_FACTOR;

	// Ensure minimum padding (about 2km)
	const minPad = 0.02;
	const pSouth = south - Math.max(latPad, minPad);
	const pNorth = north + Math.max(latPad, minPad);
	const pWest = west - Math.max(lngPad, minPad);
	const pEast = east + Math.max(lngPad, minPad);

	const zoom = ROUTING_TILE_ZOOM;
	const nw = latLngToTile(pNorth, pWest, zoom);
	const se = latLngToTile(pSouth, pEast, zoom);

	const tiles: string[] = [];
	for (let x = nw.x; x <= se.x; x++) {
		for (let y = nw.y; y <= se.y; y++) {
			tiles.push(tileKey(zoom, x, y));
		}
	}

	return tiles;
}
