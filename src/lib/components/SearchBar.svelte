<script lang="ts">
	import { routeStore } from '$lib/stores/route.svelte';
	import { reverseGeocode } from '$lib/services/geocoder';
	import type maplibregl from 'maplibre-gl';

	interface Props {
		map?: maplibregl.Map;
		onRoute?: () => void;
	}

	let { map, onRoute }: Props = $props();

	let originInput = $state(routeStore.origin?.name ?? '');
	let destInput = $state(routeStore.destination?.name ?? '');

	// Sync inputs with store
	$effect(() => {
		originInput = routeStore.origin?.name ?? '';
	});

	$effect(() => {
		destInput = routeStore.destination?.name ?? '';
	});

	function handleSwap() {
		routeStore.swapWaypoints();
	}

	function handleRoute() {
		if (routeStore.origin && routeStore.destination) {
			onRoute?.();
		}
	}

	function handleReset() {
		routeStore.reset();
	}
</script>

{#if routeStore.phase !== 'landing'}
	<div class="pointer-events-auto absolute left-1/2 top-4 z-20 -translate-x-1/2">
		<div class="glass flex items-center gap-2 rounded-2xl border border-border p-3 shadow-xl">
			<!-- Origin input -->
			<div class="flex flex-col gap-1">
				<div class="flex items-center gap-2">
					<div class="h-3 w-3 rounded-full bg-primary"></div>
					<input
						type="text"
						placeholder="Click map for start"
						value={originInput}
						readonly
						class="w-48 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
					/>
				</div>
				<div class="flex items-center gap-2">
					<div class="h-3 w-3 rounded-full bg-muted-foreground"></div>
					<input
						type="text"
						placeholder="Click map for end"
						value={destInput}
						readonly
						class="w-48 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
					/>
				</div>
			</div>

			<!-- Swap button -->
			<button
				onclick={handleSwap}
				class="flex h-8 w-8 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				title="Swap origin and destination"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>
				</svg>
			</button>

			<!-- Route button -->
			{#if routeStore.origin && routeStore.destination && routeStore.phase === 'selecting'}
				<button
					onclick={handleRoute}
					class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition-all hover:scale-105 active:scale-95"
				>
					Route
				</button>
			{/if}

			<!-- Reset button -->
			{#if routeStore.phase === 'results'}
				<button
					onclick={handleReset}
					class="rounded-xl border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
				>
					Reset
				</button>
			{/if}
		</div>

		<!-- Error message -->
		{#if routeStore.error}
			<div class="glass mt-2 rounded-xl border border-destructive/50 px-4 py-2 text-center text-sm text-destructive">
				{routeStore.error}
			</div>
		{/if}
	</div>
{/if}
