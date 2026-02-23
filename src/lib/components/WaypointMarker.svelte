<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import maplibregl from 'maplibre-gl';

	interface Props {
		map: maplibregl.Map;
		lngLat: { lng: number; lat: number };
		type: 'origin' | 'destination';
		onDragEnd?: (lngLat: { lng: number; lat: number }) => void;
	}

	let { map, lngLat, type, onDragEnd }: Props = $props();

	let marker: maplibregl.Marker | undefined;

	onMount(() => {
		const el = document.createElement('div');
		el.className = `waypoint-marker waypoint-marker-${type}`;
		el.innerHTML = type === 'origin'
			? `<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="#e8880a" stroke="white" stroke-width="3"/></svg>`
			: `<svg width="32" height="32" viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="4" fill="#7a8a9e" stroke="white" stroke-width="3"/></svg>`;
		el.style.cursor = 'grab';

		marker = new maplibregl.Marker({
			element: el,
			draggable: true,
			anchor: 'center',
		})
			.setLngLat([lngLat.lng, lngLat.lat])
			.addTo(map);

		marker.on('dragend', () => {
			const pos = marker!.getLngLat();
			onDragEnd?.({ lng: pos.lng, lat: pos.lat });
		});

		// Bounce animation
		el.style.animation = 'markerBounce 0.4s ease-out';
	});

	// Update position when lngLat changes
	$effect(() => {
		if (marker) {
			marker.setLngLat([lngLat.lng, lngLat.lat]);
		}
	});

	onDestroy(() => {
		marker?.remove();
	});
</script>
