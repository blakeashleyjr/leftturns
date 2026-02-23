<script lang="ts">
	import { routeStore } from '$lib/stores/route.svelte';
	import { formatMiles } from '$lib/utils/format';
	import { NORMAL_ROUTE_COLOR, NO_RIGHT_ROUTE_COLOR, EXTREME_ROUTE_COLOR } from '$lib/config';

	let { onRecompute }: { onRecompute?: () => void } = $props();

	let displayNormalDist = $state(0);
	let displayNoRightDist = $state(0);
	let displayExtremeDist = $state(0);

	$effect(() => {
		const normal = routeStore.normalRoute;
		const noRight = routeStore.noRightTurnsRoute;
		const extreme = routeStore.extremeRoute;

		if (normal?.found) animateValue(0, normal.distance, 800, (v) => (displayNormalDist = v));
		if (noRight?.found) animateValue(0, noRight.distance, 1200, (v) => (displayNoRightDist = v));
		if (extreme?.found) animateValue(0, extreme.distance, 1600, (v) => (displayExtremeDist = v));
	});

	function animateValue(from: number, to: number, duration: number, setter: (v: number) => void) {
		const start = performance.now();
		function frame(now: number) {
			const t = Math.min((now - start) / duration, 1);
			const eased = 1 - Math.pow(1 - t, 3);
			setter(from + (to - from) * eased);
			if (t < 1) requestAnimationFrame(frame);
		}
		requestAnimationFrame(frame);
	}

	function getExtremeCommentary(mult: number, found: boolean): string {
		if (!found) return 'Too complex for these points. EXTREME works best within ~500m.';
		if (mult < 1.5) return 'Wait... that actually worked?!';
		if (mult < 3) return 'It found a way. A very long way.';
		if (mult < 5) return 'This is unhinged. But it got there.';
		if (mult < 10) return 'The algorithm is screaming.';
		if (mult < 20) return 'You absolute maniac. Look how far it went.';
		return 'This route has gone full spiral. Beautiful chaos.';
	}
</script>

{#if routeStore.phase === 'results' && routeStore.normalRoute?.found}
	{@const normal = routeStore.normalRoute}
	{@const noRight = routeStore.noRightTurnsRoute}
	{@const extreme = routeStore.extremeRoute}
	{@const maxDist = Math.max(normal.distance, noRight?.found ? noRight.distance : 0, extreme?.found ? extreme.distance : 0)}

	<div class="pointer-events-auto absolute bottom-6 right-4 z-20 w-[340px]">
		<div class="glass rounded-2xl border border-border p-5 shadow-2xl">
			<h2 class="mb-4 text-lg font-bold text-foreground">Route Comparison</h2>

			<!-- 1. Normal route -->
			<button
				class="mb-3 flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/50"
				onclick={() => (routeStore.showNormal = !routeStore.showNormal)}
			>
				<div class="mt-1.5 flex items-center gap-2">
					<div
						class="h-3 w-3 rounded-sm border-2"
						style="border-color: {NORMAL_ROUTE_COLOR}; {routeStore.showNormal ? `background: ${NORMAL_ROUTE_COLOR}` : ''}"
					></div>
				</div>
				<div class="flex-1">
					<div class="flex items-baseline justify-between">
						<span class="text-xs font-medium text-muted-foreground">Normal</span>
					</div>
					<div class="text-xl font-bold text-foreground">{formatMiles(displayNormalDist)}</div>
				</div>
			</button>

			<!-- Bar chart -->
			<div class="mb-1 h-2 overflow-hidden rounded-full bg-muted">
				<div
					class="h-full rounded-full transition-all duration-1000"
					style="width: {(normal.distance / maxDist) * 100}%; background: {NORMAL_ROUTE_COLOR}"
				></div>
			</div>

			<!-- 2. No Right Turns -->
			<button
				class="mt-3 mb-3 flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/50"
				onclick={() => (routeStore.showNoRightTurns = !routeStore.showNoRightTurns)}
			>
				<div class="mt-1.5 flex items-center gap-2">
					<div
						class="h-3 w-3 rounded-sm border-2"
						style="border-color: {NO_RIGHT_ROUTE_COLOR}; {routeStore.showNoRightTurns ? `background: ${NO_RIGHT_ROUTE_COLOR}` : ''}"
					></div>
				</div>
				<div class="flex-1">
					<div class="flex items-baseline justify-between">
						<span class="text-xs font-medium" style="color: {NO_RIGHT_ROUTE_COLOR}">Left Turns Only</span>
						{#if noRight?.found}
							<span class="rounded-full px-2 py-0.5 text-xs font-bold" style="background: {NO_RIGHT_ROUTE_COLOR}20; color: {NO_RIGHT_ROUTE_COLOR}">
								{routeStore.noRightMultiplier.toFixed(1)}x
							</span>
						{/if}
					</div>
					{#if noRight?.found}
						<div class="text-xl font-bold" style="color: {NO_RIGHT_ROUTE_COLOR}">{formatMiles(displayNoRightDist)}</div>
					{:else}
						<div class="text-sm text-muted-foreground">No route found</div>
					{/if}
				</div>
			</button>

			{#if noRight?.found}
				<div class="mb-1 h-2 overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full transition-all duration-1000"
						style="width: {(noRight.distance / maxDist) * 100}%; background: {NO_RIGHT_ROUTE_COLOR}"
					></div>
				</div>
			{/if}

			<!-- 3. EXTREME -->
			{#if routeStore.extremeEnabled && extreme}
				<button
					class="mt-3 mb-3 flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/50"
					onclick={() => (routeStore.showExtreme = !routeStore.showExtreme)}
				>
					<div class="mt-1.5 flex items-center gap-2">
						<div
							class="h-3 w-3 rounded-sm border-2"
							style="border-color: {EXTREME_ROUTE_COLOR}; {routeStore.showExtreme ? `background: ${EXTREME_ROUTE_COLOR}` : ''}"
						></div>
					</div>
					<div class="flex-1">
						<div class="flex items-baseline justify-between">
							<span class="text-xs font-bold uppercase tracking-wide" style="color: {EXTREME_ROUTE_COLOR}">
								EXTREME
							</span>
							{#if extreme?.found}
								<span class="rounded-full px-2 py-0.5 text-xs font-bold" style="background: {EXTREME_ROUTE_COLOR}20; color: {EXTREME_ROUTE_COLOR}">
									{routeStore.extremeMultiplier.toFixed(1)}x
								</span>
							{/if}
						</div>
						{#if extreme?.found}
							<div class="text-xl font-bold" style="color: {EXTREME_ROUTE_COLOR}">{formatMiles(displayExtremeDist)}</div>
						{:else}
							<div class="text-sm text-muted-foreground">Too complex — try closer points</div>
						{/if}
					</div>
				</button>

				{#if extreme?.found}
					<div class="mb-3 h-2 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full transition-all duration-1000"
							style="width: {(extreme.distance / maxDist) * 100}%; background: {EXTREME_ROUTE_COLOR}"
						></div>
					</div>
				{/if}
			{:else}
				<button
					class="mt-3 mb-2 flex w-full items-center gap-3 rounded-lg border border-dashed border-muted-foreground/30 p-3 text-left transition-colors hover:border-[color:var(--extreme-color)] hover:bg-muted/50"
					style="--extreme-color: {EXTREME_ROUTE_COLOR}"
					onclick={() => {
						routeStore.extremeEnabled = true;
						onRecompute?.();
					}}
				>
					<div
						class="flex h-5 w-5 items-center justify-center rounded text-xs font-bold text-white"
						style="background: {EXTREME_ROUTE_COLOR}"
					>!</div>
					<div class="flex-1">
						<span class="text-xs font-bold uppercase tracking-wide" style="color: {EXTREME_ROUTE_COLOR}">
							Enable EXTREME mode
						</span>
						<div class="text-xs text-muted-foreground">Must take every left turn — slow to compute</div>
					</div>
				</button>
			{/if}

			<!-- Stats summary -->
			<div class="mb-3 border-t border-border pt-3">
				<div class="grid {extreme?.found ? 'grid-cols-3' : 'grid-cols-2'} gap-2 text-center text-xs text-muted-foreground">
					<div>
						<div class="font-medium text-foreground">{normal.turnCount}</div>
						turns
					</div>
					{#if noRight?.found}
						<div>
							<div class="font-medium" style="color: {NO_RIGHT_ROUTE_COLOR}">{noRight.leftTurnCount}</div>
							left turns
						</div>
					{:else}
						<div>-</div>
					{/if}
					{#if extreme?.found}
						<div>
							<div class="font-medium" style="color: {EXTREME_ROUTE_COLOR}">{extreme.leftTurnCount}</div>
							forced lefts
						</div>
					{/if}
				</div>
			</div>

			<!-- Commentary -->
			{#if routeStore.extremeEnabled && extreme}
				<p class="text-sm italic text-muted-foreground">
					{getExtremeCommentary(routeStore.extremeMultiplier, extreme?.found ?? false)}
				</p>
			{:else if noRight?.found}
				<p class="text-sm italic text-muted-foreground">
					{#if routeStore.noRightMultiplier < 1.1}
						Barely any difference — the normal route already avoids right turns here.
					{:else if routeStore.noRightMultiplier < 1.5}
						A modest detour to dodge every right turn.
					{:else if routeStore.noRightMultiplier < 2.5}
						No right turns means a lot of creative left turns.
					{:else}
						The long way around — but hey, no right turns!
					{/if}
				</p>
			{/if}

			<!-- Mode descriptions -->
			<div class="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
				<p><strong style="color: {NO_RIGHT_ROUTE_COLOR}">Left Turns Only</strong> — no right turns allowed, straight OK</p>
				{#if routeStore.extremeEnabled}
					<p class="mt-1"><strong style="color: {EXTREME_ROUTE_COLOR}">EXTREME</strong> — if a left turn exists, you must take it (unless already used)</p>
				{/if}
			</div>
		</div>
	</div>
{/if}
