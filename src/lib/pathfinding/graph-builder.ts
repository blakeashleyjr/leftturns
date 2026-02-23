import { Graph } from './graph';
import type { RoutingTileData } from './types';

/**
 * Build a stitched Graph from multiple routing tiles.
 * Border nodes shared across tiles are merged (same node ID = same node).
 */
export function buildGraph(tiles: RoutingTileData[]): Graph {
	const graph = new Graph();

	for (const tile of tiles) {
		// Add all nodes
		for (const node of tile.nodes) {
			if (!graph.hasNode(node.id)) {
				graph.addNode({ id: node.id, lat: node.lat, lng: node.lng });
			}
		}

		// Add all edges
		for (const edge of tile.edges) {
			graph.addEdge({
				from: edge.from,
				to: edge.to,
				dist: edge.dist,
				exitBearing: edge.exitBearing,
				entryBearing: edge.entryBearing,
				roadClass: edge.roadClass,
				geometry: edge.geometry,
			});
		}
	}

	return graph;
}
