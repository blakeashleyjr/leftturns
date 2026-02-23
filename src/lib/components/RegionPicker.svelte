<script lang="ts">
	import { routeStore } from '$lib/stores/route.svelte';
	import {
		getRegionManifest,
		downloadRegion,
		isRegionDownloaded,
		markRegionDownloaded,
	} from '$lib/services/region-manager';
	import type { Region } from '$lib/pathfinding/types';
	import { formatBytes } from '$lib/utils/format';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = $bindable(false), onClose }: Props = $props();

	let regions = $state<Region[]>([]);
	let selectedId = $state<string | null>(null);
	let downloading = $state(false);
	let downloadProgress = $state(0);
	let error = $state<string | null>(null);

	$effect(() => {
		if (open) {
			loadRegions();
		}
	});

	async function loadRegions() {
		try {
			const manifest = await getRegionManifest();
			regions = manifest.regions;
			error = null;
		} catch (err) {
			error = 'Could not load region list. Check your connection.';
		}
	}

	async function handleDownload() {
		if (!selectedId) return;
		const region = regions.find((r) => r.id === selectedId);
		if (!region) return;

		downloading = true;
		downloadProgress = 0;
		error = null;

		try {
			await downloadRegion(region, (loaded, total) => {
				downloadProgress = loaded / total;
			});
			markRegionDownloaded(region.id);
			downloading = false;
			open = false;
			onClose?.();
		} catch (err) {
			error = 'Download failed. Please try again.';
			downloading = false;
		}
	}

	function handleSkip() {
		open = false;
		onClose?.();
	}
</script>

{#if open}
	<div class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40">
		<div class="glass mx-4 w-full max-w-md rounded-2xl border border-border p-6 shadow-2xl">
			<h2 class="mb-1 text-lg font-bold text-foreground">Download Road Data</h2>
			<p class="mb-4 text-sm text-muted-foreground">
				Select a region to enable routing:
			</p>

			{#if error}
				<div class="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{error}
				</div>
			{/if}

			<div class="mb-4 max-h-60 space-y-1 overflow-y-auto">
				{#each regions as region}
					<button
						onclick={() => (selectedId = region.id)}
						class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors {selectedId === region.id
							? 'bg-primary/10 text-foreground'
							: 'hover:bg-accent text-foreground'}"
					>
						<div class="flex items-center gap-2">
							<div
								class="h-3 w-3 rounded-full border-2 {selectedId === region.id
									? 'border-primary bg-primary'
									: 'border-muted-foreground'}"
							></div>
							<span class="text-sm font-medium">{region.name}</span>
						</div>
						<div class="flex items-center gap-2">
							{#if isRegionDownloaded(region.id)}
								<span class="text-xs text-green-600">Cached</span>
							{/if}
							<span class="text-xs text-muted-foreground">
								{formatBytes(region.totalSize)}
							</span>
						</div>
					</button>
				{/each}
			</div>

			{#if downloading}
				<div class="mb-4">
					<div class="h-2 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary transition-all"
							style="width: {downloadProgress * 100}%"
						></div>
					</div>
					<p class="mt-1 text-xs text-muted-foreground">
						Downloading... {Math.round(downloadProgress * 100)}%
					</p>
				</div>
			{/if}

			<div class="flex justify-between">
				<button
					onclick={handleSkip}
					class="rounded-lg border border-input px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					Skip
				</button>
				<button
					onclick={handleDownload}
					disabled={!selectedId || downloading}
					class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
				>
					{downloading ? 'Downloading...' : 'Download'}
				</button>
			</div>

			<p class="mt-3 text-center text-xs text-muted-foreground">
				Or just click two points — tiles download automatically as needed.
			</p>
		</div>
	</div>
{/if}
