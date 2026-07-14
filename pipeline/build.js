#!/usr/bin/env bun
/**
 * build.js — one command to (re)build the dashboard database from raw CSVs.
 *
 *   1. Import every CSV in --raw-dir into vaersdata / vaersvax / vaerssymptoms.
 *   2. Run sql/build_reports.sql to materialize the `reports` + `reports_vax` model.
 *
 * Usage:
 *   bun pipeline/build.js [--raw-dir datasets/VAERS/data] [--db-path data/vaers.duckdb]
 *                         [--clean-dir data/cleaned] [--skip-import]
 *
 * `--skip-import` rebuilds only the reports model from an already-imported DB.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getArg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const rawDir = getArg('--raw-dir', 'datasets/VAERS/data');
const dbPath = getArg('--db-path', 'data/vaers.duckdb');
const cleanDir = getArg('--clean-dir', 'data/cleaned');
const skipImport = process.argv.includes('--skip-import');

async function main() {
  const t0 = Date.now();

  if (!skipImport) {
    console.log('▶ Step 1/2 — importing raw CSVs');
    const r = spawnSync(
      'bun',
      [path.join(__dirname, 'import.js'), '--raw-dir', rawDir, '--db-path', dbPath, '--clean-dir', cleanDir],
      { stdio: 'inherit' }
    );
    if (r.status !== 0) { console.error('Import step failed'); process.exit(1); }
  } else {
    console.log('▶ Step 1/2 — skipped (--skip-import)');
  }

  console.log('\n▶ Step 2/2 — building reports model (sql/build_reports.sql)');
  const sql = fs.readFileSync(path.join(__dirname, 'sql', 'build_reports.sql'), 'utf-8');
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  await conn.run(sql);

  const reports = Number(
    (await conn.runAndReadAll('SELECT COUNT(*)::BIGINT AS c FROM reports')).getRowObjects()[0].c
  );
  const rv = Number(
    (await conn.runAndReadAll('SELECT COUNT(*)::BIGINT AS c FROM reports_vax')).getRowObjects()[0].c
  );
  conn.closeSync();
  instance.closeSync();

  console.log(`\n✓ Build complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  reports:     ${reports.toLocaleString()} rows`);
  console.log(`  reports_vax: ${rv.toLocaleString()} rows`);
  console.log(`  database:    ${dbPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
