// In dev, tiles are served from /demo-tiles/ via Vite static.
// In production, tiles come from R2.
// Safe for Web Workers (no `window` reference — uses `self.location` fallback).
function getIsDev(): boolean {
	try {
		if (typeof globalThis !== 'undefined' && 'location' in globalThis) {
			return (globalThis as any).location?.hostname === 'localhost';
		}
	} catch { /* worker or SSR */ }
	return false;
}
export const TILE_BASE_URL = getIsDev() ? '/demo-tiles' : 'https://leftturns-data.your-account.r2.dev';

export const ROUTING_TILE_ZOOM = 13;

// A* safety limits
export const MAX_STATES_EXPLORED = 500_000;
export const MAX_ROUTE_DISTANCE_KM = 500;

// Bearing quantization (5° buckets = 72 per node)
export const BEARING_BUCKET_SIZE = 5;
export const BEARING_BUCKETS = 360 / BEARING_BUCKET_SIZE; // 72

// Tile fetch
export const TILE_FETCH_CONCURRENCY = 6;
export const TILE_CACHE_NAME = 'leftturns-routing-tiles';
export const REGION_DB_NAME = 'leftturns-regions';

// Route rendering
export const ROUTE_DRAW_DURATION_MS = 2000;
export const NORMAL_ROUTE_COLOR = '#7a8a9e';
export const NO_RIGHT_ROUTE_COLOR = '#e8880a';
export const EXTREME_ROUTE_COLOR = '#dc2626';

// Bounding box padding for tile fetching
export const BBOX_PAD_FACTOR = 0.25;
