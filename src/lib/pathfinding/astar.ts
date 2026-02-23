import type { Graph } from './graph';
import type { RoutingMode, RouteResult, GraphEdge } from './types';
import { PriorityQueue } from './priority-queue';
import {
	haversineDistance,
	isTurnAllowed,
	isLeftTurn,
	bearingToBucket,
	bucketToBearing,
	turnAngle,
} from './geometry';
import { MAX_STATES_EXPLORED } from '$lib/config';

/** Encode (nodeId, bearingBucket) into a single key for the visited set */
function stateKey(nodeId: number, bearingBucket: number): string {
	return `${nodeId}:${bearingBucket}`;
}

interface AStarOptions {
	graph: Graph;
	startNodeId: number;
	endNodeId: number;
	mode: RoutingMode | 'unconstrained';
	onProgress?: (statesExplored: number, queueSize: number) => void;
}

/**
 * Run A* pathfinding on the graph.
 *
 * Modes:
 * - "unconstrained": normal shortest path
 * - "no-right-turns": straight + left allowed, right turns and U-turns blocked
 * - "extreme": if a left turn is available, you MUST take it.
 *   You can skip a left turn only if you've already used that exact edge.
 *   When no unused left turns exist, straight/left are allowed (no right turns).
 *
 * For constrained modes, state = (nodeId, incomingBearingBucket).
 * For unconstrained, state = nodeId only.
 */
export function astar(options: AStarOptions): RouteResult {
	const { graph, startNodeId, endNodeId, mode, onProgress } = options;

	if (mode === 'extreme') {
		return extremeSearch(options);
	}

	const startTime = performance.now();

	const endNode = graph.getNode(endNodeId);
	if (!endNode) return emptyResult('End node not found');

	const constrained = mode !== 'unconstrained';

	const pq = new PriorityQueue<{ nodeId: number; bearingBucket: number }>();
	const gScore = new Map<string, number>();
	const cameFrom = new Map<string, { prevKey: string; edge: GraphEdge }>();

	const startBucket = -1;
	const startKey = stateKey(startNodeId, startBucket);
	gScore.set(startKey, 0);

	const startNode = graph.getNode(startNodeId);
	if (!startNode) return emptyResult('Start node not found');

	const heuristic = (nodeId: number) => {
		const node = graph.getNode(nodeId)!;
		return haversineDistance(node.lat, node.lng, endNode.lat, endNode.lng);
	};

	pq.push(heuristic(startNodeId), { nodeId: startNodeId, bearingBucket: startBucket });

	let statesExplored = 0;
	let progressCounter = 0;

	while (!pq.isEmpty()) {
		const current = pq.pop()!;
		const currentKey = stateKey(current.nodeId, current.bearingBucket);
		statesExplored++;
		progressCounter++;

		if (progressCounter >= 10_000) {
			progressCounter = 0;
			onProgress?.(statesExplored, pq.size);
		}

		if (statesExplored > MAX_STATES_EXPLORED) {
			return emptyResult('Route too complex — exceeded state limit');
		}

		if (current.nodeId === endNodeId) {
			return reconstructPath(graph, cameFrom, currentKey, statesExplored, startTime);
		}

		const currentG = gScore.get(currentKey) ?? Infinity;
		const edges = graph.getEdges(current.nodeId);

		for (const edge of edges) {
			// Check turn constraint for no-right-turns
			if (constrained && current.bearingBucket >= 0) {
				const incomingBearing = bucketToBearing(current.bearingBucket);
				if (!isTurnAllowed(incomingBearing, edge.exitBearing)) {
					continue;
				}
			}

			const tentativeG = currentG + edge.dist;
			const nextBucket = constrained ? bearingToBucket(edge.entryBearing) : 0;
			const nextKey = stateKey(edge.to, nextBucket);

			const existingG = gScore.get(nextKey) ?? Infinity;
			if (tentativeG < existingG) {
				gScore.set(nextKey, tentativeG);
				cameFrom.set(nextKey, { prevKey: currentKey, edge });
				const f = tentativeG + heuristic(edge.to);
				pq.push(f, { nodeId: edge.to, bearingBucket: nextBucket });
			}
		}
	}

	return emptyResult('No path found');
}

/**
 * Convert a path of node IDs into the corresponding GraphEdge sequence.
 * For each consecutive pair (path[i], path[i+1]), finds the edge in the graph.
 */
function pathToEdges(graph: Graph, path: number[]): GraphEdge[] {
	const edges: GraphEdge[] = [];
	for (let i = 0; i < path.length - 1; i++) {
		const from = path[i];
		const to = path[i + 1];
		const edge = graph.getEdges(from).find((e) => e.to === to);
		if (edge) {
			edges.push(edge);
		}
	}
	return edges;
}

interface DetourResult {
	found: boolean;
	edges: GraphEdge[];
	rejoinEdgeIndex: number;
	statesExplored: number;
}

/**
 * Bounded no-right-turns A* that starts from leftEdge.to and tries to
 * rejoin any backbone node ahead of currentBackboneIdx.
 *
 * Limits: 50k states, 2s wall clock per detour.
 * Heuristic: haversine to final destination (admissible).
 */
function searchDetour(
	graph: Graph,
	leftEdge: GraphEdge,
	backboneNodeToEdgeIdx: Map<number, number>,
	currentBackboneIdx: number,
	heuristic: (nodeId: number) => number,
): DetourResult {
	const DETOUR_STATE_LIMIT = 50_000;
	const DETOUR_TIME_LIMIT_MS = 2_000;
	const detourStart = performance.now();

	const pq = new PriorityQueue<{ nodeId: number; bearingBucket: number }>();
	const gScore = new Map<string, number>();
	const cameFrom = new Map<string, { prevKey: string; edge: GraphEdge }>();

	const startBucket = bearingToBucket(leftEdge.entryBearing);
	const startKey = stateKey(leftEdge.to, startBucket);

	// Check if leftEdge.to is already a backbone rejoin point
	const immediateIdx = backboneNodeToEdgeIdx.get(leftEdge.to);
	if (immediateIdx !== undefined && immediateIdx >= currentBackboneIdx) {
		return {
			found: true,
			edges: [],
			rejoinEdgeIndex: immediateIdx + 1,
			statesExplored: 0,
		};
	}

	gScore.set(startKey, 0);
	pq.push(heuristic(leftEdge.to), { nodeId: leftEdge.to, bearingBucket: startBucket });

	let statesExplored = 0;

	while (!pq.isEmpty()) {
		const current = pq.pop()!;
		const currentKey = stateKey(current.nodeId, current.bearingBucket);
		statesExplored++;

		if (statesExplored > DETOUR_STATE_LIMIT) {
			return { found: false, edges: [], rejoinEdgeIndex: 0, statesExplored };
		}
		if (statesExplored % 1_000 === 0 && performance.now() - detourStart > DETOUR_TIME_LIMIT_MS) {
			return { found: false, edges: [], rejoinEdgeIndex: 0, statesExplored };
		}

		// Check if we've reached a backbone node ahead of current position
		const backboneIdx = backboneNodeToEdgeIdx.get(current.nodeId);
		if (backboneIdx !== undefined && backboneIdx >= currentBackboneIdx) {
			// Reconstruct detour path
			const edges: GraphEdge[] = [];
			let key = currentKey;
			while (cameFrom.has(key)) {
				const { prevKey, edge } = cameFrom.get(key)!;
				edges.unshift(edge);
				key = prevKey;
			}
			return {
				found: true,
				edges,
				rejoinEdgeIndex: backboneIdx + 1,
				statesExplored,
			};
		}

		const currentG = gScore.get(currentKey) ?? Infinity;
		const edges = graph.getEdges(current.nodeId);

		for (const edge of edges) {
			// No-right-turns constraint
			if (current.bearingBucket >= 0) {
				const incomingBearing = bucketToBearing(current.bearingBucket);
				if (!isTurnAllowed(incomingBearing, edge.exitBearing)) {
					continue;
				}
			}

			const tentativeG = currentG + edge.dist;
			const nextBucket = bearingToBucket(edge.entryBearing);
			const nextKey = stateKey(edge.to, nextBucket);

			const existingG = gScore.get(nextKey) ?? Infinity;
			if (tentativeG < existingG) {
				gScore.set(nextKey, tentativeG);
				cameFrom.set(nextKey, { prevKey: currentKey, edge });
				pq.push(tentativeG + heuristic(edge.to), {
					nodeId: edge.to,
					bearingBucket: nextBucket,
				});
			}
		}
	}

	return { found: false, edges: [], rejoinEdgeIndex: 0, statesExplored };
}

/**
 * EXTREME mode: detour-based algorithm.
 *
 * 1. Compute backbone — no-right-turns A* (fast, always succeeds)
 * 2. Walk backbone — at each node, check if a left turn exists that the backbone doesn't take
 * 3. Forced left detected → take the left, run bounded no-right-turns A* to rejoin backbone
 * 4. Splice detour into final edge list, skip ahead on backbone to rejoin point
 * 5. If detour fails, continue on backbone (graceful degradation)
 *
 * No used-edge tracking → no combinatorial explosion.
 * Each detour is ~5k-20k states (vs 5M+ for global search).
 */
function extremeSearch(options: AStarOptions): RouteResult {
	const { graph, startNodeId, endNodeId, onProgress } = options;
	const startTime = performance.now();
	const TIME_LIMIT_MS = 30_000;

	// Step 1: Compute backbone — no-right-turns route
	const backbone = astar({ ...options, mode: 'no-right-turns' });
	if (!backbone.found) return backbone;

	// Step 2: Extract edge list from backbone path
	const backboneEdges = pathToEdges(graph, backbone.path);
	if (backboneEdges.length === 0) {
		return buildResult(graph, [], backbone.statesExplored, startTime);
	}

	// Step 3: Build node→edgeIndex map for fast rejoin lookup
	// Maps each node to the edge index where it's the TO node.
	// To continue from that node, use edgeIndex + 1.
	const backboneNodeToEdgeIdx = new Map<number, number>();
	for (let j = 0; j < backboneEdges.length; j++) {
		backboneNodeToEdgeIdx.set(backboneEdges[j].to, j);
	}

	const endNode = graph.getNode(endNodeId)!;
	const heuristic = (nodeId: number) => {
		const node = graph.getNode(nodeId)!;
		return haversineDistance(node.lat, node.lng, endNode.lat, endNode.lng);
	};

	// Step 4: Walk backbone, splice detours
	const finalEdges: GraphEdge[] = [];
	let totalStatesExplored = backbone.statesExplored;
	let i = 0;

	outer: while (i < backboneEdges.length) {
		// Check total time limit
		if (performance.now() - startTime > TIME_LIMIT_MS) break;

		const edge = backboneEdges[i];
		const nodeId = edge.from;
		const incomingBearing =
			finalEdges.length > 0 ? finalEdges[finalEdges.length - 1].entryBearing : -1;

		if (incomingBearing >= 0) {
			const allEdgesFromNode = graph.getEdges(nodeId);
			const leftTurns = allEdgesFromNode.filter((e) =>
				isLeftTurn(incomingBearing, e.exitBearing),
			);
			const backboneTakesLeft = isLeftTurn(incomingBearing, edge.exitBearing);

			if (leftTurns.length > 0 && !backboneTakesLeft) {
				// Forced left! Sort by gentleness (closest to 210°)
				const sortedLeftTurns = leftTurns.slice().sort((a, b) => {
					const angleA = turnAngle(incomingBearing, a.exitBearing);
					const angleB = turnAngle(incomingBearing, b.exitBearing);
					return Math.abs(angleA - 210) - Math.abs(angleB - 210);
				});

				// Try each left turn until one rejoins backbone
				for (const leftEdge of sortedLeftTurns) {
					const detour = searchDetour(
						graph,
						leftEdge,
						backboneNodeToEdgeIdx,
						i,
						heuristic,
					);
					totalStatesExplored += detour.statesExplored;

					if (detour.found) {
						finalEdges.push(leftEdge);
						finalEdges.push(...detour.edges);
						i = detour.rejoinEdgeIndex;
						continue outer;
					}
				}
			}
		}

		finalEdges.push(edge);
		i++;
	}

	// If we broke out due to time limit, append remaining backbone edges
	while (i < backboneEdges.length) {
		finalEdges.push(backboneEdges[i]);
		i++;
	}

	onProgress?.(totalStatesExplored, 0);
	return buildResult(graph, finalEdges, totalStatesExplored, startTime);
}

function reconstructPath(
	graph: Graph,
	cameFrom: Map<string, { prevKey: string; edge: GraphEdge }>,
	endKey: string,
	statesExplored: number,
	startTime: number
): RouteResult {
	const edges: GraphEdge[] = [];
	let current = endKey;

	while (cameFrom.has(current)) {
		const { prevKey, edge } = cameFrom.get(current)!;
		edges.unshift(edge);
		current = prevKey;
	}

	return buildResult(graph, edges, statesExplored, startTime);
}

function buildResult(
	graph: Graph,
	edges: GraphEdge[],
	statesExplored: number,
	startTime: number
): RouteResult {
	const geometry: [number, number][] = [];
	const nodeIds: number[] = [];
	let totalDistance = 0;
	let totalTurns = 0;
	let leftTurns = 0;

	for (let i = 0; i < edges.length; i++) {
		const edge = edges[i];
		totalDistance += edge.dist;

		if (i === 0) nodeIds.push(edge.from);
		nodeIds.push(edge.to);

		// Count turns
		if (i > 0) {
			const prevEdge = edges[i - 1];
			const angle = turnAngle(prevEdge.entryBearing, edge.exitBearing);
			if (angle > 15 && angle < 345) {
				totalTurns++;
				if (angle >= 190 && angle <= 345) {
					leftTurns++;
				}
			}
		}

		// Add edge geometry to route
		const geom = edge.geometry;
		const startIdx = geometry.length === 0 ? 0 : 2;
		for (let j = startIdx; j < geom.length; j += 2) {
			geometry.push([geom[j + 1], geom[j]]); // [lng, lat] for GeoJSON
		}
	}

	if (geometry.length === 0 && nodeIds.length > 0) {
		for (const id of nodeIds) {
			const node = graph.getNode(id);
			if (node) geometry.push([node.lng, node.lat]);
		}
	}

	return {
		found: true,
		path: nodeIds,
		geometry,
		distance: totalDistance,
		turnCount: totalTurns,
		leftTurnCount: leftTurns,
		statesExplored,
		timeMs: performance.now() - startTime,
	};
}

function emptyResult(message: string): RouteResult {
	console.warn('[A*]', message);
	return {
		found: false,
		path: [],
		geometry: [],
		distance: 0,
		turnCount: 0,
		leftTurnCount: 0,
		statesExplored: 0,
		timeMs: 0,
	};
}
