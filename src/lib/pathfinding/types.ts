/** A node in the routing graph */
export interface GraphNode {
	id: number;
	lat: number;
	lng: number;
}

/** An edge in the routing graph */
export interface GraphEdge {
	from: number;
	to: number;
	dist: number; // meters
	exitBearing: number; // degrees, direction leaving 'from'
	entryBearing: number; // degrees, direction arriving at 'to'
	roadClass: number; // 0=motorway ... 7=residential
	geometry: number[]; // flat [lat, lng, lat, lng, ...]
}

/** Raw routing tile data (from MessagePack) */
export interface RoutingTileData {
	nodes: { id: number; lat: number; lng: number }[];
	edges: {
		from: number;
		to: number;
		dist: number;
		exitBearing: number;
		entryBearing: number;
		roadClass: number;
		geometry: number[];
	}[];
	borderNodes: number[];
}

/** Routing mode */
export type RoutingMode = 'no-right-turns' | 'extreme';

/** A* search state: node + incoming bearing bucket */
export interface AStarState {
	nodeId: number;
	bearingBucket: number; // -1 for start node (no incoming bearing)
}

/** Result from the A* pathfinding */
export interface RouteResult {
	found: boolean;
	path: number[]; // node IDs
	geometry: [number, number][]; // [lng, lat] pairs for GeoJSON
	distance: number; // total meters
	turnCount: number;
	leftTurnCount: number;
	statesExplored: number;
	timeMs: number;
}

/** Messages sent to the routing worker */
export type WorkerRequest = {
	type: 'route';
	tiles: { key: string; data: ArrayBuffer }[];
	start: { lat: number; lng: number };
	end: { lat: number; lng: number };
	includeExtreme?: boolean;
};

/** Messages sent from the routing worker */
export type WorkerResponse =
	| { type: 'progress'; statesExplored: number; queueSize: number }
	| {
			type: 'result';
			normal: RouteResult;
			noRightTurns: RouteResult;
			extreme: RouteResult | null;
	  }
	| { type: 'error'; message: string };

/** Region definition from manifest */
export interface Region {
	id: string;
	name: string;
	bounds: [number, number, number, number]; // [west, south, east, north]
	tiles: string[];
	totalSize: number;
	nodeCount: number;
}

/** Region manifest */
export interface RegionManifest {
	regions: Region[];
}
