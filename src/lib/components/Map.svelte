<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import * as pmtiles from 'pmtiles';
	import { layers, namedFlavor } from '@protomaps/basemaps';

	interface Props {
		onMapReady?: (map: maplibregl.Map) => void;
		onMapClick?: (lngLat: { lng: number; lat: number }) => void;
	}

	let { onMapReady, onMapClick }: Props = $props();

	let container: HTMLDivElement;
	let map: maplibregl.Map | undefined = $state();

	onMount(() => {
		// Register PMTiles protocol
		const protocol = new pmtiles.Protocol();
		maplibregl.addProtocol('pmtiles', protocol.tile);

		map = new maplibregl.Map({
			container,
			style: {
				version: 8,
				glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
				sources: {
					protomaps: {
						type: 'vector',
						url: 'pmtiles://https://build.protomaps.com/20260220.pmtiles',
						attribution:
							'<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">© OpenStreetMap</a>',
					},
				},
				layers: layers('protomaps', namedFlavor('light')),
			},
			center: [-122.67, 45.52], // Portland, OR (demo area)
			zoom: 13,
			maxZoom: 18,
			attributionControl: {},
		});

		map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

		map.on('load', () => {
			onMapReady?.(map!);
		});

		map.on('click', (e) => {
			onMapClick?.(e.lngLat);
		});
	});

	onDestroy(() => {
		map?.remove();
	});

	export function getMap(): maplibregl.Map | undefined {
		return map;
	}
</script>

<div bind:this={container} class="absolute inset-0 h-full w-full"></div>
