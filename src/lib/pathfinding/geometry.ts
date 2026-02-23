import turfBearing from '@turf/bearing';
import turfDistance from '@turf/distance';
import { BEARING_BUCKET_SIZE, BEARING_BUCKETS } from '$lib/config';

/**
 * Calculate bearing between two points in degrees (0-360).
 * 0 = north, 90 = east, 180 = south, 270 = west.
 */
export function bearing(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number
): number {
	const b = turfBearing([lng1, lat1], [lng2, lat2]);
	return ((b % 360) + 360) % 360;
}

/**
 * Calculate the turn angle from incoming bearing to outgoing bearing.
 * Returns 0-360 where:
 *   0   = straight ahead
 *   90  = right turn
 *   180 = U-turn
 *   270 = left turn
 */
export function turnAngle(incomingBearing: number, outgoingBearing: number): number {
	return ((outgoingBearing - incomingBearing) % 360 + 360) % 360;
}

/**
 * Is this turn angle a left turn? (roughly 210°-340°)
 * Tighter than the old 200-330 range to exclude near-U-turns
 * and account for ±2.5° bearing quantization error.
 */
export function isLeftTurn(incomingBearing: number, outgoingBearing: number): boolean {
	const angle = turnAngle(incomingBearing, outgoingBearing);
	return angle >= 210 && angle <= 340;
}

/**
 * Is this turn angle roughly straight? (within 20° of ahead)
 * Tighter than ±30° to prevent borderline right turns from
 * leaking through after bearing quantization (5° buckets = ±2.5° error).
 */
export function isStraight(incomingBearing: number, outgoingBearing: number): boolean {
	const angle = turnAngle(incomingBearing, outgoingBearing);
	return angle <= 20 || angle >= 340;
}

/**
 * Check if a turn is allowed under the "no right turns" mode.
 * Allows straight + left. Blocks right turns and U-turns.
 * Uses tighter thresholds (20°/210°) to account for bearing quantization.
 */
export function isTurnAllowed(
	incomingBearing: number,
	outgoingBearing: number,
): boolean {
	const angle = turnAngle(incomingBearing, outgoingBearing);
	// Straight: within 20° of ahead
	if (angle <= 20 || angle >= 340) return true;
	// Left: 210°-340°
	if (angle >= 210 && angle < 340) return true;
	return false;
}

/**
 * Quantize a bearing to a bucket index.
 */
export function bearingToBucket(deg: number): number {
	return Math.round(((deg % 360 + 360) % 360) / BEARING_BUCKET_SIZE) % BEARING_BUCKETS;
}

/**
 * Convert a bucket back to a bearing (center of bucket).
 */
export function bucketToBearing(bucket: number): number {
	return bucket * BEARING_BUCKET_SIZE;
}

/**
 * Haversine distance between two points in meters.
 */
export function haversineDistance(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number
): number {
	return turfDistance([lng1, lat1], [lng2, lat2], { units: 'meters' });
}
