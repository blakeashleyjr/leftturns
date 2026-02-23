import type { GraphNode, GraphEdge } from './types';

/**
 * Compact adjacency-list graph with bearing metadata per edge.
 * Optimized for the turn-constrained A* search.
 */
export class Graph {
	/** node ID → GraphNode */
	private nodes = new Map<number, GraphNode>();

	/** node ID → outgoing edges */
	private adjacency = new Map<number, GraphEdge[]>();

	get nodeCount(): number {
		return this.nodes.size;
	}

	get edgeCount(): number {
		let count = 0;
		for (const edges of this.adjacency.values()) {
			count += edges.length;
		}
		return count;
	}

	addNode(node: GraphNode): void {
		this.nodes.set(node.id, node);
		if (!this.adjacency.has(node.id)) {
			this.adjacency.set(node.id, []);
		}
	}

	addEdge(edge: GraphEdge): void {
		const edges = this.adjacency.get(edge.from);
		if (edges) {
			edges.push(edge);
		} else {
			this.adjacency.set(edge.from, [edge]);
		}
	}

	getNode(id: number): GraphNode | undefined {
		return this.nodes.get(id);
	}

	getEdges(nodeId: number): GraphEdge[] {
		return this.adjacency.get(nodeId) ?? [];
	}

	hasNode(id: number): boolean {
		return this.nodes.has(id);
	}

	/**
	 * Find the nearest graph node to a given lat/lng.
	 * Uses simple Euclidean approximation for speed (fine for nearby nodes).
	 */
	findNearest(lat: number, lng: number): GraphNode | undefined {
		let best: GraphNode | undefined;
		let bestDist = Infinity;

		for (const node of this.nodes.values()) {
			const dlat = node.lat - lat;
			const dlng = (node.lng - lng) * Math.cos((lat * Math.PI) / 180);
			const dist = dlat * dlat + dlng * dlng;
			if (dist < bestDist) {
				bestDist = dist;
				best = node;
			}
		}

		return best;
	}

	/** Get all node IDs */
	getAllNodeIds(): number[] {
		return Array.from(this.nodes.keys());
	}
}
