/**
 * scripts/smoke-test.mjs
 *
 * Production startup smoke test (spec §25, §34).
 *
 * Starts the built server (dist/server.js), polls /health and /ready,
 * and exits non-zero if the server fails to start or the health checks fail.
 *
 * Usage:
 *   npm run build
 *   npm run start:smoke
 */

import { spawn } from 'child_process';
import { once } from 'events';

const PORT = process.env.PORT || '3001';
const BASE_URL = `http://localhost:${PORT}`;
const STARTUP_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return res;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}

async function main() {
  console.log(`🚀  Starting smoke test against ${BASE_URL}...`);

  const child = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let childError = '';
  child.stderr.on('data', (d) => (childError += d.toString()));

  try {
    // Wait for /health
    console.log('   Waiting for /health...');
    const healthRes = await waitForServer(`${BASE_URL}/health`, STARTUP_TIMEOUT_MS);
    const health = await healthRes.json();
    if (health.status !== 'ok') {
      throw new Error(`/health returned unexpected body: ${JSON.stringify(health)}`);
    }
    console.log('   ✅  /health OK');

    // Wait for /ready
    console.log('   Checking /ready...');
    const readyRes = await waitForServer(`${BASE_URL}/ready`, STARTUP_TIMEOUT_MS);
    const ready = await readyRes.json();
    if (ready.status !== 'ready') {
      throw new Error(`/ready returned unexpected body: ${JSON.stringify(ready)}`);
    }
    console.log('   ✅  /ready OK');

    console.log('\n✅  Smoke test PASSED.');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌  Smoke test FAILED: ${err.message}`);
    if (childError) {
      console.error(`\nServer stderr:\n${childError}`);
    }
    process.exit(1);
  } finally {
    child.kill('SIGTERM');
  }
}

main();
