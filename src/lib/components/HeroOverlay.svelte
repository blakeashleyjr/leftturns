<script lang="ts">
	import { routeStore } from '$lib/stores/route.svelte';

	function handleStart() {
		routeStore.phase = 'selecting';
	}
</script>

{#if routeStore.phase === 'landing'}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="pointer-events-auto absolute inset-0 z-10 flex cursor-pointer items-center justify-center"
		onclick={handleStart}
	>
		<div
			class="glass mx-4 max-w-lg rounded-2xl border border-border px-8 py-12 text-center shadow-2xl"
		>
			<h1 class="mb-2 text-4xl font-bold tracking-tight text-foreground">
				Left Turns Only
			</h1>
			<p class="mb-8 text-lg text-muted-foreground">
				What happens when you can never turn right?
			</p>
			<p class="mb-8 text-sm text-muted-foreground">
				Route between any two points using only left turns, then compare to the
				normal route. Everything runs locally in your browser.
			</p>
			<button
				onclick={handleStart}
				class="rounded-xl bg-primary px-8 py-3 text-lg font-semibold text-primary-foreground shadow-lg transition-all hover:scale-105 hover:shadow-xl active:scale-95"
			>
				Click the map to start
			</button>
		</div>
	</div>
{/if}
