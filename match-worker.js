import { parentPort, workerData } from 'node:worker_threads';
import { findMatches } from './matcher.js';

try {
  parentPort.postMessage(findMatches(workerData.polymarket, workerData.kalshi));
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
