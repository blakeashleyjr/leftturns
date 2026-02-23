<script lang="ts">
	import { onDestroy } from 'svelte';
	import type maplibregl from 'maplibre-gl';
	import { routeStore } from '$lib/stores/route.svelte';
	import { animateRouteDraw } from '$lib/utils/animate';
	import { NORMAL_ROUTE_COLOR, NO_RIGHT_ROUTE_COLOR, EXTREME_ROUTE_COLOR } from '$lib/config';

	interface Props {
		map: maplibregl.Map;
	}

	let { map }: Props = $props();

	let cancelNormal: (() => void) | null = null;
	let cancelNoRight: (() => void) | null = null;
	let cancelExtreme: (() => void) | null = null;
	let sourcesAdded = false;

	function ensureSources() {
		if (sourcesAdded) return;

		// Add sources
		for (const id of ['normal-route', 'noright-route', 'extreme-route']) {
			map.addSource(id, { type: 'geojson', data: emptyLineString() });
		}

		// Normal route: gray dashed (bottom)
		map.addLayer({
			id: 'normal-route-line',
			type: 'line',
			source: 'normal-route',
			paint: {
				'line-color': NORMAL_ROUTE_COLOR,
				'line-width': 5,
				'line-dasharray': [2, 2],
				'line-opacity': 0.7,
			},
		});

		// No-right-turns route: orange solid (middle)
		map.addLayer({
			id: 'noright-route-line',
			type: 'line',
			source: 'noright-route',
			paint: {
				'line-color': NO_RIGHT_ROUTE_COLOR,
				'line-width': 5,
				'line-opacity': 0.85,
			},
		});

		// Extreme route: red solid (top)
		map.addLayer({
			id: 'extreme-route-line',
			type: 'line',
			source: 'extreme-route',
			paint: {
				'line-color': EXTREME_ROUTE_COLOR,
				'line-width': 5,
				'line-opacity': 0.85,
			},
		});

		sourcesAdded = true;
	}

	function emptyLineString(): GeoJSON.Feature<GeoJSON.LineString> {
		return {
			type: 'Feature',
			properties: {},
			geometry: { type: 'LineString', coordinates: [] },
		};
	}

	function setRouteData(sourceId: string, coords: [number, number][]) {
		const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
		if (!source) return;
		if (coords.length < 2) {
			source.setData(emptyLineString());
			return;
		}
		source.setData({
			type: 'Feature',
			properties: {},
			geometry: { type: 'LineString', coordinates: coords },
		});
	}

	function setLayerVisibility(layerId: string, visible: boolean) {
		if (map.getLayer(layerId)) {
			map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
		}
	}

	// React to route changes
	$effect(() => {
		const normal = routeStore.normalRoute;
		const noRight = routeStore.noRightTurnsRoute;
		const extreme = routeStore.extremeRoute;

		cancelNormal?.();
		cancelNoRight?.();
		cancelExtreme?.();

		ensureSources();

		if (!normal?.found && !noRight?.found && !extreme?.found) {
			setRouteData('normal-route', []);
			setRouteData('noright-route', []);
			setRouteData('extreme-route', []);
			return;
		}

		// Animate normal route (quick)
		if (normal?.found && normal.geometry.length > 1) {
			cancelNormal = animateRouteDraw(
				normal.geometry,
				(partial) => setRouteData('normal-route', partial),
				800
			);
		}

		// Animate no-right-turns route (medium)
		if (noRight?.found && noRight.geometry.length > 1) {
			setTimeout(() => {
				cancelNoRight = animateRouteDraw(
					noRight.geometry,
					(partial) => setRouteData('noright-route', partial),
					1500
				);
			}, 400);
		}

		// Animate extreme route (dramatic, delayed)
		if (extreme?.found && extreme.geometry.length > 1) {
			setTimeout(() => {
				cancelExtreme = animateRouteDraw(
					extreme.geometry,
					(partial) => setRouteData('extreme-route', partial),
					2500
				);
			}, 800);
		}

		// Fit bounds to all routes
		const allCoords = [
			...(normal?.geometry ?? []),
			...(noRight?.geometry ?? []),
			...(extreme?.geometry ?? []),
		];
		if (allCoords.length > 0) {
			const lngs = allCoords.map((c) => c[0]);
			const lats = allCoords.map((c) => c[1]);
			map.fitBounds(
				[
					[Math.min(...lngs), Math.min(...lats)],
					[Math.max(...lngs), Math.max(...lats)],
				],
				{ padding: { top: 100, bottom: 100, left: 50, right: 350 }, duration: 1000 }
			);
		}
	});

	// React to visibility toggles
	$effect(() => {
		if (!sourcesAdded) return;
		setLayerVisibility('normal-route-line', routeStore.showNormal);
	});
	$effect(() => {
		if (!sourcesAdded) return;
		setLayerVisibility('noright-route-line', routeStore.showNoRightTurns);
	});
	$effect(() => {
		if (!sourcesAdded) return;
		setLayerVisibility('extreme-route-line', routeStore.showExtreme);
	});

	onDestroy(() => {
		cancelNormal?.();
		cancelNoRight?.();
		cancelExtreme?.();

		if (sourcesAdded && map) {
			try {
				for (const id of ['extreme-route-line', 'noright-route-line', 'normal-route-line']) {
					map.removeLayer(id);
				}
				for (const id of ['extreme-route', 'noright-route', 'normal-route']) {
					map.removeSource(id);
				}
			} catch { /* Map may already be destroyed */ }
		}
	});
</script>
