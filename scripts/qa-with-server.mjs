#!/usr/bin/env node
/**
 * Rule 0 (offline) + HTTP smoke against a **new** `server.js` on an ephemeral port.
 * Use when `localhost:3400` is another process, or a long-running `server.js` is stale
 * (older builds may not expose JSON 404 for unknown `/api/*` paths — smoke expects that contract).
 *
 * Run: `npm run qa:isolated`
 *
 * Runs **`scripts/smoke-gate-paths-sync.mjs`** first so **`CRITICAL`** and **`SMOKE_GATE_API_PATHS`** cannot drift.
 *
 * After **`rule0:check`**, runs **`npm run test:layout`** (disk-only responsive CSS links), then HTTP smoke, then **`npm run test:name-mgmt`**, **`npm run test:fleet-mileage`**, and **`npm run test:integrity-meta`** (aligned with **`npm run qa:automated`** aside from **`test:qbo-dedupe-purchase`**).
 *
 * **`npm run qa:automated`** ( **`package.json`** ) runs the same **`smoke-gate-paths-sync`** step before **`rule0:check`** + **`smoke`** when a server is already listening — no child process here.
 *
 * Sets **`IH35_SMOKE_GATE=1`** on the child **`server.js`** so HTTP smoke passes **`/api/*`** GETs used by **`system-smoke.mjs`** even when ERP login is required (users in **`data/app-users.json`**). Do not set **`IH35_SMOKE_GATE`** on long-lived production listeners unless you intend to relax auth for those read-only probes.
 * When **`CI=true`** (e.g. GitHub Actions), passes **`SMOKE_QUIET=1`** to **`system-smoke.mjs`** so the success footer line is omitted.
 * **`SIGINT`** / **`SIGTERM`**: **`SIGTERM`** the child **`server.js`**, any in-flight **`rule0:check`** / **`smoke`** Node child, then **`process.exit`** (**130** / **143**) so the parent does not hang (installing signal handlers disables the default Ctrl+C exit).
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref?.();
    s.listen(0, '127.0.0.1', () => {
      try {
        const addr = s.address();
        const p = typeof addr === 'object' && addr ? addr.port : null;
        s.close((err) => (err ? reject(err) : resolve(p)));
      } catch (e) {
        try {
          s.close();
        } catch {}
        reject(e);
      }
    });
    s.on('error', reject);
  });
}

async function waitHealth(base, ms = 45000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Health check failed for ${base} within ${ms}ms`);
}

function waitUntilHealthy(server, base) {
  return new Promise((resolve, reject) => {
    const onExit = (code, sig) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`server exited before healthy: ${code}${sig ? ` (${sig})` : ''}`));
      }
    };
    server.once('exit', onExit);
    waitHealth(base)
      .then(() => {
        server.removeListener('exit', onExit);
        resolve();
      })
      .catch((e) => {
        server.removeListener('exit', onExit);
        reject(e);
      });
  });
}

async function main() {
  const sync = spawnSync(process.execPath, [path.join(root, 'scripts/smoke-gate-paths-sync.mjs')], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SMOKE_GATE_SYNC_QUIET: process.env.CI === 'true' ? '1' : process.env.SMOKE_GATE_SYNC_QUIET }
  });
  if (sync.error) throw sync.error;
  if (sync.status !== 0) process.exit(sync.status ?? 1);

  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const envPort = { PORT: String(port), IH35_SMOKE_GATE: '1' };

  const server = spawn('node', ['server.js'], {
    cwd: root,
    env: { ...process.env, ...envPort },
    stdio: 'inherit',
  });

  let scriptChild = null;
  function runNodeScript(rel, extraEnv, extraArgs = []) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [path.join(root, rel), ...extraArgs], {
        cwd: root,
        env: { ...process.env, ...extraEnv },
        stdio: 'inherit',
      });
      scriptChild = child;
      child.on('error', (e) => {
        scriptChild = null;
        reject(e);
      });
      child.on('exit', (code, sig) => {
        scriptChild = null;
        if (code === 0) resolve();
        else reject(new Error(`${rel} exited with ${code}${sig ? ` (${sig})` : ''}`));
      });
    });
  }

  function runNpmScript(scriptName) {
    return new Promise((resolve, reject) => {
      const child = spawn('npm', ['run', scriptName], {
        cwd: root,
        env: { ...process.env },
        stdio: 'inherit',
      });
      scriptChild = child;
      child.on('error', (e) => {
        scriptChild = null;
        reject(e);
      });
      child.on('exit', (code, sig) => {
        scriptChild = null;
        if (code === 0) resolve();
        else reject(new Error(`npm run ${scriptName} exited with ${code}${sig ? ` (${sig})` : ''}`));
      });
    });
  }

  function stopOnSignal(exitCode) {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
    if (server.pid) {
      try {
        server.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    if (scriptChild?.pid) {
      try {
        scriptChild.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    process.exit(exitCode);
  }
  const onSigInt = () => stopOnSignal(130);
  const onSigTerm = () => stopOnSignal(143);
  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);

  try {
    await waitUntilHealthy(server, base);
    await runNodeScript('scripts/rule-zero-agent-b-check.mjs', envPort, ['--skip-release-tip']);
    await runNpmScript('test:layout');
    const smokeEnv = {
      ...envPort,
      SMOKE_BASE: base,
      ...(process.env.CI === 'true' ? { SMOKE_QUIET: '1' } : {})
    };
    if (process.env.CI === 'true' && !String(process.env.SMOKE_TIMEOUT_MS || '').trim()) {
      smokeEnv.SMOKE_TIMEOUT_MS = '15000';
    }
    await runNodeScript('scripts/system-smoke.mjs', smokeEnv);
    await runNpmScript('test:name-mgmt');
    await runNpmScript('test:fleet-mileage');
    await runNpmScript('test:integrity-meta');
    console.log(`qa:isolated OK — ${base} (smoke + rule0 + unit tests)`);
  } finally {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
    if (server.pid) {
      try {
        server.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 800));
      try {
        server.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
