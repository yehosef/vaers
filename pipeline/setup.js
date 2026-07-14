#!/usr/bin/env bun
/**
 * setup.js — one command to go from a fresh clone to a working dashboard database.
 *
 *   1. Unzip datasets/AllVAERSDataCSVS.zip (the full 1990-present bundle) into
 *      datasets/VAERS/data/.
 *   2. Unzip any additional per-year bundles in datasets/ (e.g. 2026VAERSData.zip)
 *      OVER THE TOP — so a freshly-downloaded current-year file replaces the
 *      bundle's stale copy of that year.
 *   3. Run the full build (import every CSV + build the reports model).
 *   4. Report the size of what was extracted and created.
 *
 * Monthly update: drop a fresh <YEAR>VAERSData.zip into datasets/ and re-run
 * `bun pipeline/setup.js` (or, faster, import just that file — see the README).
 *
 * Requires the `unzip` CLI (preinstalled on macOS; `apt-get install unzip` on Debian/Ubuntu).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const datasetsDir = path.join(root, 'datasets');
const rawDir = path.join(datasetsDir, 'VAERS', 'data');
const bundle = path.join(datasetsDir, 'AllVAERSDataCSVS.zip');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\n✖ \`${cmd} ${args.join(' ')}\` failed`); process.exit(1); }
}

function unzipInto(zip, dest) {
  // -o overwrite, -j flatten (ignore any nested folders in the zip)
  run('unzip', ['-o', '-j', zip, '*VAERS*.csv', '-d', dest]);
}

function humanSize(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${u[i]}`;
}
function pathSize(p) {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (st.isFile()) return st.size;
  return fs.readdirSync(p).reduce((s, f) => s + pathSize(path.join(p, f)), 0);
}

async function main() {
  const t0 = Date.now();

  if (!fs.existsSync(bundle)) {
    console.error(`✖ Missing ${path.relative(root, bundle)}.`);
    console.error(`  This file is stored in git LFS — run \`git lfs pull\` to fetch it.`);
    process.exit(1);
  }
  // Start from a clean extraction dir so stray/renamed CSVs from a previous run
  // don't get imported alongside the fresh bundle (silent duplicate years).
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });

  console.log('▶ 1/3  Unzipping the all-years bundle');
  unzipInto(bundle, rawDir);

  // Additional per-year bundles override the stale copy in the all-years bundle.
  const yearZips = fs.readdirSync(datasetsDir)
    .filter((f) => /VAERSData\.zip$/i.test(f) && f !== 'AllVAERSDataCSVS.zip');
  if (yearZips.length) {
    console.log(`▶ 1b   Applying ${yearZips.length} year update(s) over the top: ${yearZips.join(', ')}`);
    for (const z of yearZips) unzipInto(path.join(datasetsDir, z), rawDir);
  }

  console.log('\n▶ 2/3  Building the database (import + reports model)');
  run('bun', [path.join(root, 'pipeline', 'build.js')]);

  console.log('\n▶ 3/3  Done. Sizes:');
  const rows = [
    ['bundle (datasets/AllVAERSDataCSVS.zip)', pathSize(bundle)],
    ['extracted CSVs (datasets/VAERS/data)', pathSize(rawDir)],
    ['database (data/vaers.duckdb)', pathSize(path.join(root, 'data', 'vaers.duckdb'))],
    ['transcode cache (data/cleaned)', pathSize(path.join(root, 'data', 'cleaned'))],
  ];
  for (const [label, bytes] of rows) console.log(`   ${humanSize(bytes).padStart(9)}  ${label}`);
  console.log(`\n✓ Setup complete in ${((Date.now() - t0) / 1000).toFixed(0)}s. Start the app:`);
  console.log('   (terminal 1) cd server && npm start');
  console.log('   (terminal 2) cd web && npm run dev   →  http://localhost:3000');
}

main().catch((e) => { console.error(e); process.exit(1); });
