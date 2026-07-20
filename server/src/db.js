// DuckDB access layer — READ_ONLY connection pool, bound params, JS-normalized rows.
import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATHS = [
  process.env.VAERS_DB,
  path.resolve(__dirname, '../../data/vaers.duckdb'),
  path.resolve(__dirname, '../../../data/vaers.duckdb'),
].filter(Boolean);

function resolveDbPath() {
  for (const p of DB_PATHS) if (fs.existsSync(p)) return p;
  throw new Error(`Database not found. Searched:\n${DB_PATHS.join('\n')}\nRun \`bun pipeline/build.js\` first.`);
}

let instance = null;
let dbPath = null;

// A DuckDB connection runs one statement at a time — sharing a single connection
// across concurrent requests intermittently fails with "Failed to execute prepared
// statement". The dashboard fires /api/dashboard and /api/cases in parallel on
// every load, which is exactly that case, so hand each query its own connection
// from a small pool. The database is READ_ONLY, so extra connections are cheap
// and give real parallelism.
const POOL_SIZE = Math.max(2, Number(process.env.VAERS_DB_POOL) || 4);
let allConnections = [];   // every connection, for shutdown
let idle = [];             // connections free right now
let waiters = [];          // resolvers waiting for a connection

// Validate a directory is writable by writing (then deleting) a throwaway probe file.
function assertWritable(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.probe-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, '');
  fs.unlinkSync(probe);
}

// DuckDB spills large sorts/aggregates to disk under memory_limit pressure — pick a
// writable temp dir before opening the instance: env override, else next to the DB
// file, else the OS temp dir.
function resolveTempDir() {
  const primary = process.env.VAERS_DB_TMP || path.join(path.dirname(dbPath), '.duckdb_tmp');
  try {
    assertWritable(primary);
    return primary;
  } catch {
    const fallback = path.join(os.tmpdir(), 'vaers-duckdb-tmp');
    assertWritable(fallback); // let this throw if even the OS temp dir isn't writable
    return fallback;
  }
}

export async function initDb() {
  dbPath = resolveDbPath();
  const tempDir = resolveTempDir();
  console.log(`🗃️  DuckDB temp directory: ${tempDir}`);
  // memory_limit is instance-global (shared by every pooled connection). Default 550MB
  // targets a ~1GB VPS; override with VAERS_DB_MEMORY (e.g. '900MB') on a bigger box.
  const memoryLimit = process.env.VAERS_DB_MEMORY || '550MB';
  instance = await DuckDBInstance.create(dbPath, {
    access_mode: 'READ_ONLY',
    memory_limit: memoryLimit,
    temp_directory: tempDir,
    max_temp_directory_size: '5GB',
    // The dashboard fires ~14 aggregate queries concurrently over a shared, capped
    // memory budget; a broad filter makes several of them build large hash tables at
    // once and blow the limit (hard OOM -> 500). Every panel query is an explicitly
    // ORDER BY'd aggregate, so insertion order is never relied upon — dropping it lets
    // DuckDB stream aggregates with far less resident memory (its own OOM hint).
    preserve_insertion_order: false,
  });
  console.log(`   memory_limit=${memoryLimit}, panel_concurrency via VAERS_PANEL_CONCURRENCY`);
  allConnections = await Promise.all(
    Array.from({ length: POOL_SIZE }, () => instance.connect())
  );
  idle = [...allConnections];
  waiters = [];
  console.log(`📊 Connected (READ_ONLY, pool of ${POOL_SIZE}): ${dbPath}`);
  return dbPath;
}

function acquire() {
  const conn = idle.pop();
  if (conn) return Promise.resolve(conn);
  return new Promise((resolve) => waiters.push(resolve)); // all busy — queue
}

function release(conn) {
  const next = waiters.shift();
  if (next) next(conn);
  else idle.push(conn);
}

export function getDbPath() { return dbPath; }

// Convert DuckDB values to plain JS: BigInt -> Number, recurse arrays/objects.
function normalize(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    // DuckDB value wrappers expose items/toString; fall back to string.
    if (typeof value.items !== 'undefined') return normalize(value.items);
    return value;
  }
  return value;
}

function normalizeRow(row) {
  const out = {};
  for (const k of Object.keys(row)) out[k] = normalize(row[k]);
  return out;
}

// Run a query with positional ($1,$2,...) params; return normalized row objects.
export async function all(sql, params = []) {
  if (!instance) throw new Error('DB not initialized');
  const conn = await acquire();
  try {
    const reader = await conn.runAndReadAll(sql, params);
    return reader.getRowObjects().map(normalizeRow);
  } finally {
    release(conn); // always return it, even if the query threw
  }
}

export async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] ?? null;
}

export function closeDb() {
  for (const conn of allConnections) { try { conn.closeSync(); } catch {} }
  allConnections = []; idle = []; waiters = [];
  try { instance?.closeSync(); } catch {}
}
