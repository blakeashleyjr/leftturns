import { TILE_BASE_URL, TILE_FETCH_CONCURRENCY } from '$lib/config';

const tileCache = new Map<string, ArrayBuffer>();

/**
 * Fetch a single routing tile. Returns cached if available.
 */
export async function fetchTile(tileKey: string): Promise<ArrayBuffer | null> {
	// Check memory cache
	if (tileCache.has(tileKey)) {
		return tileCache.get(tileKey)!;
	}

	// Check IndexedDB cache
	const cached = await getFromIndexedDB(tileKey);
	if (cached) {
		tileCache.set(tileKey, cached);
		return cached;
	}

	// Fetch from tile server (local demo or R2)
	const isLocal = TILE_BASE_URL.startsWith('/');
	const url = isLocal
		? `${TILE_BASE_URL}/${tileKey}.bin.gz`
		: `${TILE_BASE_URL}/routing/${tileKey}.bin.gz`;
	try {
		const response = await fetch(url);
		if (!response.ok) {
			if (response.status === 404) return null;
			throw new Error(`Tile fetch failed: ${response.status}`);
		}
		// Decompress gzip if the server didn't do it for us.
		// Vite static server serves .gz files as-is without Content-Encoding.
		let buffer: ArrayBuffer;
		const contentEncoding = response.headers.get('content-encoding');
		if (contentEncoding === 'gzip' || contentEncoding === 'deflate') {
			// Browser already decompressed
			buffer = await response.arrayBuffer();
		} else {
			// Decompress manually using DecompressionStream
			const compressed = await response.arrayBuffer();
			buffer = await decompressGzip(compressed);
		}
		tileCache.set(tileKey, buffer);
		await saveToIndexedDB(tileKey, buffer);
		return buffer;
	} catch (err) {
		console.warn(`Failed to fetch tile ${tileKey}:`, err);
		return null;
	}
}

/**
 * Fetch multiple tiles with concurrency limit and progress reporting.
 */
export async function fetchTiles(
	tileKeys: string[],
	onProgress?: (loaded: number, total: number) => void
): Promise<Map<string, ArrayBuffer>> {
	const results = new Map<string, ArrayBuffer>();
	let loaded = 0;

	// Process in batches for concurrency control
	const queue = [...tileKeys];
	const workers: Promise<void>[] = [];

	for (let i = 0; i < Math.min(TILE_FETCH_CONCURRENCY, queue.length); i++) {
		workers.push(
			(async () => {
				while (queue.length > 0) {
					const key = queue.shift()!;
					const data = await fetchTile(key);
					if (data) {
						results.set(key, data);
					}
					loaded++;
					onProgress?.(loaded, tileKeys.length);
				}
			})()
		);
	}

	await Promise.all(workers);
	return results;
}

// --- Gzip decompression ---

async function decompressGzip(compressed: ArrayBuffer): Promise<ArrayBuffer> {
	const ds = new DecompressionStream('gzip');
	const writer = ds.writable.getWriter();
	writer.write(new Uint8Array(compressed));
	writer.close();

	const reader = ds.readable.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}

	const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result.buffer;
}

// --- IndexedDB helpers ---

const DB_NAME = 'leftturns-tiles-v2';
const STORE_NAME = 'tiles';

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE_NAME);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function getFromIndexedDB(key: string): Promise<ArrayBuffer | null> {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const req = store.get(key);
			req.onsuccess = () => resolve(req.result ?? null);
			req.onerror = () => reject(req.error);
		});
	} catch {
		return null;
	}
}

async function saveToIndexedDB(key: string, data: ArrayBuffer): Promise<void> {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const req = store.put(data, key);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	} catch {
		// Silently fail — cache is best-effort
	}
}

/**
 * Clear all cached tiles from IndexedDB.
 */
export async function clearTileCache(): Promise<void> {
	tileCache.clear();
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const req = store.clear();
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	} catch {
		// Silently fail
	}
}

/**
 * Get total size of cached tiles.
 */
export async function getCacheSize(): Promise<number> {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const req = store.getAll();
			req.onsuccess = () => {
				const total = (req.result as ArrayBuffer[]).reduce(
					(sum, buf) => sum + buf.byteLength,
					0
				);
				resolve(total);
			};
			req.onerror = () => reject(req.error);
		});
	} catch {
		return 0;
	}
}
