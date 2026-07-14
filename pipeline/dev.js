#!/usr/bin/env bun
/**
 * dev.js — one command to go from a fresh clone to a running dashboard.
 *
 *   bun run dev        (or: bun pipeline/dev.js)
 *
 * It will, in order:
 *   1. Install dependencies (root + server/ + web/) if node_modules is missing.
 *   2. Build the database if data/vaers.duckdb is missing — this downloads the
 *      ~560 MB data bundle from the GitHub Release and builds it (a few minutes,
 *      needs the `unzip` CLI + ~15 GB free disk). See pipeline/setup.js.
 *   3. Start the API (:3001) and the web dashboard (:3000) together and stream
 *      both logs here. Open http://localhost:3000 and Ctrl-C to stop both.
 *
 * Everything after step 2 is instant on subsequent runs.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = path.join(root, 'data', 'vaers.duckdb');

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n✖ \`${cmd} ${args.join(' ')}\` failed in ${path.relative(root, cwd) || '.'}`);
    process.exit(1);
  }
}

// 1. Dependencies -----------------------------------------------------------
if (!fs.existsSync(path.join(root, 'node_modules'))) {
  console.log('▶ Installing root (pipeline) deps…');
  sh('bun', ['install'], root);
}
for (const app of ['server', 'web']) {
  if (!fs.existsSync(path.join(root, app, 'node_modules'))) {
    console.log(`▶ Installing ${app}/ deps…`);
    sh('npm', ['install'], path.join(root, app));
  }
}

// 2. Data -------------------------------------------------------------------
if (!fs.existsSync(db)) {
  console.log('▶ No database yet — running setup (download bundle + build)…');
  sh('bun', [path.join(root, 'pipeline', 'setup.js')], root);
} else {
  console.log(`▶ Using existing database (${(fs.statSync(db).size / 1073741824).toFixed(1)} GB).`);
}

// 3. Servers ----------------------------------------------------------------
console.log('\n▶ Starting API (:3001) and dashboard (:3000). Ctrl-C stops both.\n');

/** Spawn a long-running child, prefixing each output line so the two interleave readably. */
function serve(label, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, env: process.env });
  const tag = `[${label}] `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(tag + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.error(`\n✖ [${label}] exited (${code}). Shutting down.`);
    shutdown();
  });
  return child;
}

const children = [];
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const c of children) { try { c.kill('SIGTERM'); } catch {} }
  process.exit(1);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

children.push(serve('api', 'node', ['src/app.js'], path.join(root, 'server')));
children.push(serve('web', 'npm', ['run', 'dev'], path.join(root, 'web')));

console.log('   → http://localhost:3000  (dashboard; proxies /api → :3001)\n');
