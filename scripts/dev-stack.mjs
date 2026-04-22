#!/usr/bin/env node
/**
 * Local dev: main Express (`server.js`) proxies `/api/drivers`, `/api/assets`, etc. to
 * the fleet hub API (`apps/fleet-reports-hub/server/index.mjs`) on INTEGRITY_API_PORT (8787).
 * This script starts both so `fleet-registry-proxy` does not hit ECONNREFUSED.
 *
 * Skip the API child: IH35_SKIP_FLEET_API=1 npm run dev
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const hub = path.join(root, 'apps', 'fleet-reports-hub');
const apiPort = Number(process.env.INTEGRITY_API_PORT || 8787);

function canBindPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, host);
  });
}

const ensure = spawnSync(process.execPath, [path.join(__dirname, 'ensure-fleet-reports-dist.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (ensure.status !== 0) process.exit(ensure.status ?? 1);

let apiChild = null;
/** @type {import('node:child_process').ChildProcess | null} */
let web = null;
const skipApi = process.env.IH35_SKIP_FLEET_API === '1';

if (!skipApi) {
  const free = await canBindPort(apiPort);
  if (!free) {
    console.log(
      `[dev-stack] Port ${apiPort} already in use — skipping embedded fleet API (reuse existing listener).`,
    );
  } else {
    apiChild = spawn(process.execPath, ['server/index.mjs'], {
      cwd: hub,
      env: { ...process.env, INTEGRITY_API_PORT: String(apiPort) },
      stdio: 'inherit',
    });
    apiChild.on('exit', (code, sig) => {
      if (sig === 'SIGTERM') return;
      console.error('[dev-stack] Fleet API process exited', { code, signal: sig });
      try {
        web?.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      process.exit(code ?? 1);
    });
  }
}

web = spawn(process.execPath, ['--watch', path.join(root, 'server.js')], {
  cwd: root,
  stdio: 'inherit',
});

function shutdownApi() {
  try {
    apiChild?.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

web.on('exit', (code) => {
  shutdownApi();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  shutdownApi();
  try {
    web?.kill('SIGINT');
  } catch {
    /* ignore */
  }
});
process.on('SIGTERM', () => {
  shutdownApi();
  try {
    web?.kill('SIGTERM');
  } catch {
    /* ignore */
  }
});
