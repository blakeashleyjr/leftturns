import { unpack } from 'msgpackr';
import { buildGraph } from './graph-builder';
import { astar } from './astar';
import type { WorkerRequest, WorkerResponse, RoutingTileData } from './types';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const req = event.data;

	if (req.type === 'route') {
		try {
			handleRoute(req);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Unknown error';
			respond({ type: 'error', message: msg });
		}
	}
};

function handleRoute(req: WorkerRequest) {
	// Parse tiles from MessagePack
	const tiles: RoutingTileData[] = req.tiles.map((t) => {
		const data = new Uint8Array(t.data);
		return unpack(data) as RoutingTileData;
	});

	// Build graph
	const graph = buildGraph(tiles);

	if (graph.nodeCount === 0) {
		respond({ type: 'error', message: 'No road data available for this area' });
		return;
	}

	// Snap start/end to nearest nodes
	const startNode = graph.findNearest(req.start.lat, req.start.lng);
	const endNode = graph.findNearest(req.end.lat, req.end.lng);

	if (!startNode || !endNode) {
		respond({ type: 'error', message: 'Could not snap points to road network' });
		return;
	}

	if (startNode.id === endNode.id) {
		respond({ type: 'error', message: 'Start and end snap to the same node — try farther points' });
		return;
	}

	const progressCallback = (statesExplored: number, queueSize: number) => {
		respond({ type: 'progress', statesExplored, queueSize });
	};

	const baseOpts = {
		graph,
		startNodeId: startNode.id,
		endNodeId: endNode.id,
		onProgress: progressCallback,
	};

	// Run normal + no-right-turns always; extreme only if requested
	const normal = astar({ ...baseOpts, mode: 'unconstrained' });
	const noRightTurns = astar({ ...baseOpts, mode: 'no-right-turns' });
	const extreme = req.includeExtreme
		? astar({ ...baseOpts, mode: 'extreme' })
		: null;

	respond({ type: 'result', normal, noRightTurns, extreme });
}

function respond(msg: WorkerResponse) {
	self.postMessage(msg);
}
