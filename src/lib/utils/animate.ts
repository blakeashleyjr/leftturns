import { ROUTE_DRAW_DURATION_MS } from '$lib/config';

/**
 * Animate a route being drawn on the map.
 * Returns a cancel function.
 *
 * @param coordinates - Full route as [lng, lat][]
 * @param onFrame - Called each frame with the partial coordinate array
 * @param duration - Animation duration in ms
 */
export function animateRouteDraw(
	coordinates: [number, number][],
	onFrame: (partial: [number, number][]) => void,
	duration = ROUTE_DRAW_DURATION_MS
): () => void {
	if (coordinates.length === 0) {
		onFrame([]);
		return () => {};
	}

	let cancelled = false;
	const startTime = performance.now();

	// Compute cumulative distances for even interpolation
	const distances: number[] = [0];
	for (let i = 1; i < coordinates.length; i++) {
		const [lng1, lat1] = coordinates[i - 1];
		const [lng2, lat2] = coordinates[i];
		const dx = lng2 - lng1;
		const dy = lat2 - lat1;
		distances.push(distances[i - 1] + Math.sqrt(dx * dx + dy * dy));
	}
	const totalDist = distances[distances.length - 1];

	function frame(now: number) {
		if (cancelled) return;

		const elapsed = now - startTime;
		const t = Math.min(elapsed / duration, 1);
		// Ease-out cubic
		const eased = 1 - Math.pow(1 - t, 3);

		const targetDist = eased * totalDist;

		// Find how many points to show
		let idx = 1;
		while (idx < distances.length && distances[idx] < targetDist) {
			idx++;
		}

		// Interpolate partial last segment
		const partial = coordinates.slice(0, idx);
		if (idx < coordinates.length && idx > 0) {
			const segStart = distances[idx - 1];
			const segEnd = distances[idx];
			const segLen = segEnd - segStart;
			if (segLen > 0) {
				const frac = (targetDist - segStart) / segLen;
				const [lng1, lat1] = coordinates[idx - 1];
				const [lng2, lat2] = coordinates[idx];
				partial.push([
					lng1 + (lng2 - lng1) * frac,
					lat1 + (lat2 - lat1) * frac,
				]);
			}
		}

		onFrame(partial);

		if (t < 1) {
			requestAnimationFrame(frame);
		}
	}

	requestAnimationFrame(frame);

	return () => {
		cancelled = true;
	};
}
