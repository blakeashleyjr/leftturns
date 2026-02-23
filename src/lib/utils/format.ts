/** Format meters to human-readable distance */
export function formatDistance(meters: number): string {
	if (meters < 1000) {
		return `${Math.round(meters)} m`;
	}
	const km = meters / 1000;
	if (km < 100) {
		return `${km.toFixed(1)} km`;
	}
	return `${Math.round(km)} km`;
}

/** Format meters to miles */
export function formatMiles(meters: number): string {
	const miles = meters / 1609.344;
	if (miles < 0.1) {
		return `${Math.round(meters * 3.28084)} ft`;
	}
	if (miles < 100) {
		return `${miles.toFixed(1)} mi`;
	}
	return `${Math.round(miles)} mi`;
}

/** Format milliseconds to human-readable duration */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Format bytes to human-readable size */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Format a multiplier (e.g., "2.7x longer") */
export function formatMultiplier(constrained: number, normal: number): string {
	if (normal === 0) return '—';
	const ratio = constrained / normal;
	if (ratio < 1.05) return 'Same distance';
	return `${ratio.toFixed(1)}x longer`;
}
