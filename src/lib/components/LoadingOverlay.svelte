<script lang="ts">
	import { routeStore } from '$lib/stores/route.svelte';
</script>

{#if routeStore.phase === 'loading'}
	<div
		class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/20"
	>
		<div class="glass rounded-2xl border border-border px-8 py-6 text-center shadow-2xl">
			<!-- Spinner -->
			<div class="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-primary"></div>

			<p class="mb-2 text-sm font-medium text-foreground">
				{routeStore.loadingMessage || 'Computing routes...'}
			</p>

			{#if routeStore.loadingProgress > 0}
				<div class="mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full bg-primary transition-all"
						style="width: {routeStore.loadingProgress * 100}%"
					></div>
				</div>
			{/if}
		</div>
	</div>
{/if}
