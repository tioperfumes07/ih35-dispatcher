#!/usr/bin/env node
import { execSync, spawn } from 'node:child_process';

function pidsListeningOn(port) {
  try {
    const out = execSync(`lsof -nP -tiTCP:${port} -sTCP:LISTEN`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (!out) return [];
    return out
      .split('\n')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

const selfPid = process.pid;
const ports = [3100, 8787];
const all = new Set();
for (const port of ports) {
  for (const pid of pidsListeningOn(port)) {
    if (pid !== selfPid) all.add(pid);
  }
}

for (const pid of all) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Ignore stale or unauthorized pids.
  }
}

setTimeout(() => {
  const child = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}, 400);
