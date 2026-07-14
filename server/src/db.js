// DuckDB access layer — single READ_ONLY connection, bound params, JS-normalized rows.
import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'node:fs';
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
let connection = null;
let dbPath = null;

export async function initDb() {
  dbPath = resolveDbPath();
  instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
  connection = await instance.connect();
  console.log(`📊 Connected (READ_ONLY): ${dbPath}`);
  return dbPath;
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
  if (!connection) throw new Error('DB not initialized');
  const reader = await connection.runAndReadAll(sql, params);
  return reader.getRowObjects().map(normalizeRow);
}

export async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] ?? null;
}

export function closeDb() {
  try { connection?.closeSync(); } catch {}
  try { instance?.closeSync(); } catch {}
}
