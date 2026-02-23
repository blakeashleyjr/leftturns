<script lang="ts">
	import type maplibregl from 'maplibre-gl';
	import Map from '$lib/components/Map.svelte';
	import HeroOverlay from '$lib/components/HeroOverlay.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import WaypointMarker from '$lib/components/WaypointMarker.svelte';
	import RouteLayer from '$lib/components/RouteLayer.svelte';
	import RouteComparison from '$lib/components/RouteComparison.svelte';
	import RegionPicker from '$lib/components/RegionPicker.svelte';
	import LoadingOverlay from '$lib/components/LoadingOverlay.svelte';
	import { routeStore } from '$lib/stores/route.svelte';
	import { reverseGeocode } from '$lib/services/geocoder';
	import { fetchTiles } from '$lib/services/tile-loader';
	import { getTilesForBounds } from '$lib/utils/tiles';
	import type { WorkerResponse } from '$lib/pathfinding/types';

	let map = $state<maplibregl.Map>();
	let worker: Worker | undefined;

	function handleMapReady(m: maplibregl.Map) {
		map = m;
	}

	function handleMapClick(lngLat: { lng: number; lat: number }) {
		if (routeStore.phase === 'landing') {
			routeStore.phase = 'selecting';
		}

		if (routeStore.phase === 'loading') return;

		const result = map
			? reverseGeocode(map, lngLat)
			: null;

		const waypoint = {
			lat: lngLat.lat,
			lng: lngLat.lng,
			name: result?.name ?? `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`,
		};

		if (!routeStore.origin) {
			routeStore.setOrigin(waypoint);
		} else if (!routeStore.destination) {
			routeStore.setDestination(waypoint);
			setTimeout(() => computeRoute(), 50);
		} else {
			routeStore.setDestination(waypoint);
			setTimeout(() => computeRoute(), 50);
		}
	}

	function handleOriginDrag(lngLat: { lng: number; lat: number }) {
		const result = map ? reverseGeocode(map, lngLat) : null;
		routeStore.setOrigin({
			lat: lngLat.lat,
			lng: lngLat.lng,
			name: result?.name ?? `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`,
		});
	}

	function handleDestDrag(lngLat: { lng: number; lat: number }) {
		const result = map ? reverseGeocode(map, lngLat) : null;
		routeStore.setDestination({
			lat: lngLat.lat,
			lng: lngLat.lng,
			name: result?.name ?? `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`,
		});
	}

	async function computeRoute() {
		if (!routeStore.origin || !routeStore.destination) return;

		routeStore.setLoading('Fetching road data...');

		try {
			const tileKeys = getTilesForBounds(
				routeStore.origin.lat,
				routeStore.origin.lng,
				routeStore.destination.lat,
				routeStore.destination.lng
			);

			const tiles = await fetchTiles(tileKeys, (loaded, total) => {
				routeStore.loadingProgress = (loaded / total) * 0.5;
				routeStore.loadingMessage = `Fetching tiles... ${loaded}/${total}`;
			});

			if (tiles.size === 0) {
				routeStore.setError(
					'No road data for this area. In the demo, click within Portland, OR (the area visible on the map).'
				);
				return;
			}

			routeStore.loadingMessage = 'Computing all three routes...';
			routeStore.loadingProgress = 0.5;

			if (!worker) {
				worker = new Worker(
					new URL('../lib/pathfinding/worker.ts', import.meta.url),
					{ type: 'module' }
				);
			}

			const tileArray = Array.from(tiles.entries()).map(([key, data]) => ({
				key,
				data: data.slice(0),
			}));

			worker.postMessage(
				{
					type: 'route',
					tiles: tileArray,
					start: { lat: routeStore.origin.lat, lng: routeStore.origin.lng },
					end: { lat: routeStore.destination.lat, lng: routeStore.destination.lng },
					includeExtreme: routeStore.extremeEnabled,
				} satisfies import('$lib/pathfinding/types').WorkerRequest,
				tileArray.map((t) => t.data)
			);

			worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
				const msg = event.data;
				if (msg.type === 'progress') {
					// Logarithmic progress: approaches 1.0 asymptotically
					const logProgress = Math.min(Math.log10(1 + msg.statesExplored / 100_000) / 2, 0.5);
					routeStore.loadingProgress = 0.5 + logProgress;
					routeStore.loadingMessage = `Exploring... ${msg.statesExplored.toLocaleString()} states`;
				} else if (msg.type === 'result') {
					routeStore.setRoutes(msg.normal, msg.noRightTurns, msg.extreme);
				} else if (msg.type === 'error') {
					routeStore.setError(msg.message);
				}
			};
		} catch (err) {
			routeStore.setError(
				err instanceof Error ? err.message : 'An error occurred while computing the route.'
			);
		}
	}
</script>

<div class="relative h-full w-full">
	<Map onMapReady={handleMapReady} onMapClick={handleMapClick} />

	<div class="pointer-events-none absolute inset-0 z-10">
		<HeroOverlay />
		<SearchBar {map} onRoute={computeRoute} />
		<LoadingOverlay />
		<RouteComparison onRecompute={computeRoute} />
		<RegionPicker bind:open={routeStore.regionPickerOpen} />
	</div>

	{#if map}
		{#if routeStore.origin}
			<WaypointMarker
				{map}
				lngLat={{ lng: routeStore.origin.lng, lat: routeStore.origin.lat }}
				type="origin"
				onDragEnd={handleOriginDrag}
			/>
		{/if}

		{#if routeStore.destination}
			<WaypointMarker
				{map}
				lngLat={{ lng: routeStore.destination.lng, lat: routeStore.destination.lat }}
				type="destination"
				onDragEnd={handleDestDrag}
			/>
		{/if}

		{#if routeStore.phase === 'results'}
			<RouteLayer {map} />
		{/if}
	{/if}
</div>
