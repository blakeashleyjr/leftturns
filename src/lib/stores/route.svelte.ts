import type { RouteResult } from '$lib/pathfinding/types';

export type AppPhase = 'landing' | 'selecting' | 'loading' | 'results';

export interface Waypoint {
	lat: number;
	lng: number;
	name: string;
}

class RouteStore {
	phase = $state<AppPhase>('landing');

	origin = $state<Waypoint | null>(null);
	destination = $state<Waypoint | null>(null);

	/** All three route results, computed simultaneously */
	normalRoute = $state<RouteResult | null>(null);
	noRightTurnsRoute = $state<RouteResult | null>(null);
	extremeRoute = $state<RouteResult | null>(null);

	/** Whether to compute EXTREME route (off by default — expensive) */
	extremeEnabled = $state(false);

	/** Which routes are visible on the map */
	showNormal = $state(true);
	showNoRightTurns = $state(true);
	showExtreme = $state(true);

	loadingMessage = $state('');
	loadingProgress = $state(0);
	error = $state<string | null>(null);

	regionPickerOpen = $state(false);

	get hasRoute(): boolean {
		return this.normalRoute !== null;
	}

	get noRightMultiplier(): number {
		if (!this.normalRoute?.found || !this.noRightTurnsRoute?.found) return 0;
		if (this.normalRoute.distance === 0) return 0;
		return this.noRightTurnsRoute.distance / this.normalRoute.distance;
	}

	get extremeMultiplier(): number {
		if (!this.normalRoute?.found || !this.extremeRoute?.found) return 0;
		if (this.normalRoute.distance === 0) return 0;
		return this.extremeRoute.distance / this.normalRoute.distance;
	}

	setOrigin(waypoint: Waypoint) {
		this.origin = waypoint;
		this.clearRoutes();
		if (this.phase === 'landing') {
			this.phase = 'selecting';
		}
	}

	setDestination(waypoint: Waypoint) {
		this.destination = waypoint;
		this.clearRoutes();
	}

	swapWaypoints() {
		const tmp = this.origin;
		this.origin = this.destination;
		this.destination = tmp;
		this.clearRoutes();
	}

	setRoutes(normal: RouteResult, noRightTurns: RouteResult, extreme: RouteResult | null) {
		this.normalRoute = normal;
		this.noRightTurnsRoute = noRightTurns;
		this.extremeRoute = extreme;
		this.phase = 'results';
		this.error = null;
	}

	setLoading(message: string, progress = 0) {
		this.phase = 'loading';
		this.loadingMessage = message;
		this.loadingProgress = progress;
	}

	setError(message: string) {
		this.error = message;
		this.phase = 'selecting';
	}

	clearRoutes() {
		this.normalRoute = null;
		this.noRightTurnsRoute = null;
		this.extremeRoute = null;
		this.error = null;
		if (this.phase === 'results') {
			this.phase = 'selecting';
		}
	}

	reset() {
		this.phase = 'landing';
		this.origin = null;
		this.destination = null;
		this.normalRoute = null;
		this.noRightTurnsRoute = null;
		this.extremeRoute = null;
		this.showNormal = true;
		this.showNoRightTurns = true;
		this.showExtreme = true;
		this.loadingMessage = '';
		this.loadingProgress = 0;
		this.error = null;
	}
}

export const routeStore = new RouteStore();
