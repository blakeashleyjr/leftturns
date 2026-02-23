import type { Map as MaplibreMap } from 'maplibre-gl';

export interface GeocoderResult {
	name: string;
	type: string;
	lat: number;
	lng: number;
}

/**
 * Reverse geocode a point using MapLibre's rendered features.
 * Queries the vector tile layers for place/POI names at the clicked point.
 */
export function reverseGeocode(
	map: MaplibreMap,
	lngLat: { lng: number; lat: number }
): GeocoderResult | null {
	const point = map.project(lngLat);

	// Query rendered features in a small radius
	const features = map.queryRenderedFeatures(
		[
			[point.x - 20, point.y - 20],
			[point.x + 20, point.y + 20],
		],
		{
			layers: undefined, // query all layers
		}
	);

	// Look for a named feature
	for (const feature of features) {
		const props = feature.properties;
		if (!props) continue;

		const name = props.name || props['name:en'] || props.name_en;
		if (name) {
			return {
				name,
				type: props.class || props.type || 'place',
				lat: lngLat.lat,
				lng: lngLat.lng,
			};
		}
	}

	// Fall back to coordinate string
	return {
		name: `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`,
		type: 'coordinate',
		lat: lngLat.lat,
		lng: lngLat.lng,
	};
}

/** Place index entry for forward geocoding */
interface PlaceEntry {
	name: string;
	type: string;
	lat: number;
	lng: number;
	pop?: number;
}

let placeIndex: PlaceEntry[] = [];

/**
 * Load a place index for forward geocoding.
 */
export function loadPlaceIndex(entries: PlaceEntry[]): void {
	placeIndex = entries;
}

/**
 * Forward geocode — search loaded place index by name.
 * Returns top matches sorted by population/relevance.
 */
export function forwardGeocode(query: string, limit = 5): GeocoderResult[] {
	if (!query || query.length < 2) return [];

	const q = query.toLowerCase();
	const matches: (PlaceEntry & { score: number })[] = [];

	for (const entry of placeIndex) {
		const name = entry.name.toLowerCase();
		if (name.startsWith(q)) {
			matches.push({ ...entry, score: (entry.pop ?? 0) + 1_000_000 });
		} else if (name.includes(q)) {
			matches.push({ ...entry, score: entry.pop ?? 0 });
		}
	}

	return matches
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ name, type, lat, lng }) => ({ name, type, lat, lng }));
}
