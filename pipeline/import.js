#!/usr/bin/env bun
/**
 * VAERS CSV importer — bun + @duckdb/node-api + iconv-lite.
 *
 * Faithful port of vaers-duckdb/vaers_import.py:
 *   - VAERS CSVs are windows-1252; transcode to UTF-8 (Unix EOL) into data/cleaned/.
 *   - Load each file into vaersdata / vaersvax / vaerssymptoms with an explicit schema,
 *     read_csv_auto + store_rejects (+ dateformat for domestic; all_varchar + strptime
 *     for NonDomestic), plus FILE_NAME / FILE_LINE_NO / IS_DOMESTIC metadata.
 *   - Reject tables + import_summary preserved. PRIMARY KEY (VAERS_ID, FILE_NAME,
 *     FILE_LINE_NO) with INSERT OR IGNORE for incremental --append dedup.
 *
 * Usage:
 *   bun pipeline/import.js [--raw-dir datasets/VAERS/data] [--db-path data/vaers.duckdb]
 *                          [--clean-dir data/cleaned] [--files A.csv B.csv ...] [--append]
 */

import { DuckDBInstance } from '@duckdb/node-api';
import iconv from 'iconv-lite';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {
    rawDir: 'datasets/VAERS/data',
    cleanDir: 'data/cleaned',
    dbPath: 'data/vaers.duckdb',
    files: null,
    append: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--raw-dir') args.rawDir = argv[++i];
    else if (a === '--clean-dir') args.cleanDir = argv[++i];
    else if (a === '--db-path') args.dbPath = argv[++i];
    else if (a === '--append') args.append = true;
    else if (a === '--files') {
      args.files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args.files.push(argv[++i]);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Schemas (mirror vaers_import.py get_table_schema / get_expected_columns)
// ---------------------------------------------------------------------------
const DATE_COLUMNS = ['RECVDATE', 'RPT_DATE', 'DATEDIED', 'VAX_DATE', 'ONSET_DATE', 'TODAYS_DATE'];

const SCHEMAS = {
  vaersdata: `
    VAERS_ID VARCHAR, RECVDATE DATE, STATE VARCHAR, AGE_YRS DOUBLE, CAGE_YR DOUBLE,
    CAGE_MO DOUBLE, SEX VARCHAR, RPT_DATE DATE, SYMPTOM_TEXT TEXT, DIED VARCHAR,
    DATEDIED DATE, L_THREAT VARCHAR, ER_VISIT VARCHAR, HOSPITAL VARCHAR, HOSPDAYS INTEGER,
    X_STAY VARCHAR, DISABLE VARCHAR, RECOVD VARCHAR, VAX_DATE DATE, ONSET_DATE DATE,
    NUMDAYS INTEGER, LAB_DATA TEXT, V_ADMINBY VARCHAR, V_FUNDBY VARCHAR, OTHER_MEDS TEXT,
    CUR_ILL TEXT, HISTORY TEXT, PRIOR_VAX VARCHAR, SPLTTYPE VARCHAR, FORM_VERS VARCHAR,
    TODAYS_DATE DATE, BIRTH_DEFECT VARCHAR, OFC_VISIT VARCHAR, ER_ED_VISIT VARCHAR,
    ALLERGIES VARCHAR, REPORT_ORDER INTEGER, IS_DOMESTIC BOOLEAN, FILE_NAME VARCHAR, FILE_LINE_NO INTEGER,
    PRIMARY KEY (VAERS_ID, FILE_NAME, FILE_LINE_NO)`,
  vaersvax: `
    VAERS_ID VARCHAR, VAX_TYPE VARCHAR, VAX_MANU VARCHAR, VAX_LOT VARCHAR,
    VAX_DOSE_SERIES VARCHAR, VAX_ROUTE VARCHAR, VAX_SITE VARCHAR, VAX_NAME VARCHAR,
    REPORT_ORDER INTEGER, IS_DOMESTIC BOOLEAN, FILE_NAME VARCHAR, FILE_LINE_NO INTEGER,
    PRIMARY KEY (VAERS_ID, FILE_NAME, FILE_LINE_NO)`,
  vaerssymptoms: `
    VAERS_ID VARCHAR, SYMPTOM1 VARCHAR, SYMPTOMVERSION1 VARCHAR, SYMPTOM2 VARCHAR,
    SYMPTOMVERSION2 VARCHAR, SYMPTOM3 VARCHAR, SYMPTOMVERSION3 VARCHAR, SYMPTOM4 VARCHAR,
    SYMPTOMVERSION4 VARCHAR, SYMPTOM5 VARCHAR, SYMPTOMVERSION5 VARCHAR,
    REPORT_ORDER INTEGER, IS_DOMESTIC BOOLEAN, FILE_NAME VARCHAR, FILE_LINE_NO INTEGER,
    PRIMARY KEY (VAERS_ID, FILE_NAME, FILE_LINE_NO)`,
};

const EXPECTED_COLUMNS = {
  vaersdata: ['VAERS_ID', 'RECVDATE', 'STATE', 'AGE_YRS', 'CAGE_YR', 'CAGE_MO', 'SEX',
    'RPT_DATE', 'SYMPTOM_TEXT', 'DIED', 'DATEDIED', 'L_THREAT', 'ER_VISIT', 'HOSPITAL',
    'HOSPDAYS', 'X_STAY', 'DISABLE', 'RECOVD', 'VAX_DATE', 'ONSET_DATE', 'NUMDAYS',
    'LAB_DATA', 'V_ADMINBY', 'V_FUNDBY', 'OTHER_MEDS', 'CUR_ILL', 'HISTORY', 'PRIOR_VAX',
    'SPLTTYPE', 'FORM_VERS', 'TODAYS_DATE', 'BIRTH_DEFECT', 'OFC_VISIT', 'ER_ED_VISIT',
    'ALLERGIES'],
  vaersvax: ['VAERS_ID', 'VAX_TYPE', 'VAX_MANU', 'VAX_LOT', 'VAX_DOSE_SERIES', 'VAX_ROUTE',
    'VAX_SITE', 'VAX_NAME'],
  vaerssymptoms: ['VAERS_ID', 'SYMPTOM1', 'SYMPTOMVERSION1', 'SYMPTOM2', 'SYMPTOMVERSION2',
    'SYMPTOM3', 'SYMPTOMVERSION3', 'SYMPTOM4', 'SYMPTOMVERSION4', 'SYMPTOM5',
    'SYMPTOMVERSION5'],
};

function getTableName(fileName) {
  const u = fileName.toUpperCase();
  if (u.includes('VAERSDATA')) return 'vaersdata';
  if (u.includes('VAERSSYMPTOMS')) return 'vaerssymptoms';
  if (u.includes('VAERSVAX')) return 'vaersvax';
  return null;
}

const isNonDomestic = (fileName) => fileName.toUpperCase().startsWith('NONDOMESTIC');
const isDomesticFile = (fileName) => !isNonDomestic(fileName);
const sqlPath = (p) => p.replace(/'/g, "''"); // escape for single-quoted SQL literal

// ---------------------------------------------------------------------------
// Transcode windows-1252 -> UTF-8 (streaming), Unix line endings.
// ---------------------------------------------------------------------------
function cleanAndConvert(srcPath, dstPath) {
  return new Promise((resolve, reject) => {
    const read = fs.createReadStream(srcPath);
    const decode = iconv.decodeStream('windows-1252');
    const encode = iconv.encodeStream('utf-8');
    const write = fs.createWriteStream(dstPath);
    // Normalize CRLF/CR -> LF as bytes pass through the decoded text stream.
    let tail = '';
    decode.on('data', (chunk) => {
      let s = tail + chunk;
      // hold a trailing '\r' so we don't split a CRLF across chunk boundary
      if (s.endsWith('\r')) { tail = '\r'; s = s.slice(0, -1); } else { tail = ''; }
      s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      encode.write(s);
    });
    decode.on('end', () => {
      if (tail) encode.write(tail.replace(/\r/g, '\n'));
      encode.end();
    });
    read.on('error', reject);
    decode.on('error', reject);
    encode.on('error', reject);
    write.on('error', reject);
    write.on('finish', resolve);
    read.pipe(decode);
    encode.pipe(write);
  });
}

// ---------------------------------------------------------------------------
// Import one cleaned CSV.  Returns { imported, rejected }.
// ---------------------------------------------------------------------------
async function importOne(conn, cleanPath, fileName, tableName, append) {
  const domestic = isDomesticFile(fileName);
  const nonDom = isNonDomestic(fileName);
  // Canonicalize the stored FILE_NAME so a case/rename drift (2026VAERSData.csv vs
  // 2026VAERSDATA.csv, browser "(1)" copies) can't defeat the append DELETE and
  // silently duplicate a whole year.
  const canonName = fileName.toUpperCase();
  const tmp = `temp_${tableName}_${process.pid}_${Math.abs(hashCode(fileName))}`;

  const readOpts = nonDom
    ? `ignore_errors = true, store_rejects = true, rejects_limit = 10000, all_varchar = true`
    : `ignore_errors = true, store_rejects = true, rejects_limit = 1000, dateformat = '%m/%d/%Y', timestampformat = '%m/%d/%Y'`;

  await conn.run(`DROP TABLE IF EXISTS ${tmp}`);
  await conn.run(`
    CREATE TEMP TABLE ${tmp} AS
    SELECT *,
      '${sqlPath(canonName)}' AS FILE_NAME,
      row_number() OVER () AS FILE_LINE_NO,
      ${domestic ? 'true' : 'false'} AS IS_DOMESTIC
    FROM read_csv_auto('${sqlPath(cleanPath)}', ${readOpts})
  `);

  // Capture rejects for this scan before they are overwritten by the next read.
  let rejected = 0;
  try {
    const r = await conn.runAndReadAll(`SELECT COUNT(*)::BIGINT AS c FROM reject_errors`);
    rejected = Number(r.getRowObjects()[0].c);
    if (rejected > 0) {
      await conn.run(`
        INSERT INTO vaers_reject_errors
          (file_name, table_name, scan_id, file_id, line, column_idx, column_name, error_type, csv_line, error_message)
        SELECT '${sqlPath(fileName)}', '${tableName}', scan_id, file_id, line, column_idx, column_name, error_type, csv_line, error_message
        FROM reject_errors
      `);
    }
    // store_rejects appends to reject_errors/reject_scans across reads in the same
    // connection; clear them so the next file's count is isolated (not cumulative).
    await conn.run(`DELETE FROM reject_errors`).catch(() => {});
    await conn.run(`DELETE FROM reject_scans`).catch(() => {});
  } catch { /* no reject tables this run */ }

  const importCount = Number(
    (await conn.runAndReadAll(`SELECT COUNT(*)::BIGINT AS c FROM ${tmp}`)).getRowObjects()[0].c
  );

  // Ensure target table exists.
  await conn.run(`CREATE TABLE IF NOT EXISTS ${tableName} (${SCHEMAS[tableName]})`);

  // Guard: in --append a file that parsed to 0 rows must NOT wipe the existing
  // year (a truncated/corrupt re-download shouldn't silently empty it).
  if (append && importCount === 0) {
    console.warn(`\n  ⚠ ${fileName}: parsed 0 rows — leaving existing rows in place (not replaced)`);
    await conn.run(`DROP TABLE IF EXISTS ${tmp}`);
    return { imported: 0, rejected };
  }

  let insertSql = null;
  if (importCount > 0) {
    const cols = EXPECTED_COLUMNS[tableName];
    // Post-May-2025 files carry a trailing ORDER column = report sequence per
    // VAERS_ID (1 = primary, >1 = secondary/follow-up). Older files lack it → 1.
    const tempRows = (await conn.runAndReadAll(`DESCRIBE ${tmp}`)).getRowObjects();
    const tempCols = tempRows.map((r) => r.column_name);
    const tempTypes = Object.fromEntries(
      tempRows.map((r) => [r.column_name, String(r.column_type).toUpperCase()])
    );
    const orderExpr = tempCols.includes('ORDER')
      ? `COALESCE(TRY_CAST("ORDER" AS INTEGER), 1)` : `1`;
    const targetMeta = ['REPORT_ORDER', 'IS_DOMESTIC', 'FILE_NAME', 'FILE_LINE_NO'];
    const sourceMeta = [orderExpr, 'IS_DOMESTIC', 'FILE_NAME', 'FILE_LINE_NO'];
    const columnList = [...cols, ...targetMeta].join(', ');
    // Never trust the CSV sniffer to type a date column. It infers from what it
    // samples, so a column that is almost entirely empty lands on VARCHAR (2016's
    // TODAYS_DATE holds 4 values in 50,712 rows) — and the INSERT would then cast
    // those MM/DD/YYYY strings with the default ISO format and fail the whole file.
    // Parse explicitly off the type the temp table actually has.
    const dateSelect = (c) => {
      const t = tempTypes[c] || '';
      if (t === 'DATE') return c;
      if (t.startsWith('TIMESTAMP')) return `CAST(${c} AS DATE) AS ${c}`;
      return `TRY_CAST(strptime(CAST(${c} AS VARCHAR), '%m/%d/%Y') AS DATE) AS ${c}`;
    };
    const baseSelect = cols.map((c) => (DATE_COLUMNS.includes(c) ? dateSelect(c) : c));
    const selectList = [...baseSelect, ...sourceMeta].join(', ');

    // The strptime fallback above uses TRY_CAST, which turns an unparseable value
    // into NULL. Count those so a real format drift is reported instead of quietly
    // emptying a column.
    for (const c of cols) {
      if (!DATE_COLUMNS.includes(c)) continue;
      if (tempTypes[c] === 'DATE' || (tempTypes[c] || '').startsWith('TIMESTAMP')) continue;
      const q = await conn.runAndReadAll(`
        SELECT COUNT(*)::BIGINT AS c FROM ${tmp}
        WHERE ${c} IS NOT NULL
          AND TRY_CAST(strptime(CAST(${c} AS VARCHAR), '%m/%d/%Y') AS DATE) IS NULL
      `);
      const bad = Number(q.getRowObjects()[0].c);
      if (bad > 0) console.warn(`\n  ⚠ ${fileName}: ${bad} unparseable ${c} value(s) → NULL`);
    }
    insertSql = `INSERT INTO ${tableName} (${columnList}) SELECT ${selectList} FROM ${tmp}`;
  }

  // Atomic replace: a file's DELETE + INSERT run in one transaction, so a failure
  // can't leave the year deleted-but-not-reinserted. Plain INSERT (no OR IGNORE)
  // so a real PK collision surfaces loudly instead of silently dropping rows.
  await conn.run('BEGIN TRANSACTION');
  try {
    if (append) await conn.run(`DELETE FROM ${tableName} WHERE FILE_NAME = '${sqlPath(canonName)}'`);
    if (insertSql) await conn.run(insertSql);
    await conn.run('COMMIT');
  } catch (e) {
    await conn.run('ROLLBACK').catch(() => {});
    throw e;
  }

  await conn.run(`DROP TABLE IF EXISTS ${tmp}`);
  return { imported: importCount, rejected };
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.rawDir)) {
    console.error(`Raw directory not found: ${args.rawDir}`);
    // setup.js reclaims the extracted CSVs once the database is built, so this is
    // the expected state after a normal setup — point at the command that restores them.
    console.error(`Run \`bun run setup\` to re-extract the CSVs from the bundle and rebuild.`);
    process.exit(1);
  }
  fs.mkdirSync(args.cleanDir, { recursive: true });
  fs.mkdirSync(path.dirname(args.dbPath), { recursive: true });

  let csvFiles;
  if (args.files) {
    csvFiles = args.files
      .filter((f) => f.endsWith('.csv'))
      .map((f) => (path.isAbsolute(f) || f.includes('/') ? f : path.join(args.rawDir, f)));
    const missing = csvFiles.filter((f) => !fs.existsSync(f));
    if (missing.length) console.warn(`Missing files: ${missing.map((f) => path.basename(f)).join(', ')}`);
    csvFiles = csvFiles.filter((f) => fs.existsSync(f));
  } else {
    csvFiles = fs.readdirSync(args.rawDir)
      .filter((f) => f.endsWith('.csv'))
      .sort()
      .map((f) => path.join(args.rawDir, f));
  }
  if (!csvFiles.length) {
    console.error('No CSV files found to import');
    process.exit(1);
  }

  console.log(`${args.append ? 'Appending to' : 'Creating'} database: ${args.dbPath}`);
  console.log(`Found ${csvFiles.length} CSV files to process`);

  const instance = await DuckDBInstance.create(args.dbPath);
  const conn = await instance.connect();

  await conn.run(`
    CREATE TABLE IF NOT EXISTS import_summary (
      file_name VARCHAR, table_name VARCHAR, rows_imported INTEGER,
      rows_rejected INTEGER, import_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await conn.run(`
    CREATE TABLE IF NOT EXISTS vaers_reject_errors (
      file_name VARCHAR, table_name VARCHAR, scan_id UBIGINT, file_id UBIGINT, line UBIGINT,
      column_idx UBIGINT, column_name VARCHAR, error_type VARCHAR, csv_line VARCHAR,
      error_message VARCHAR, rejection_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

  let totalImported = 0;
  let totalRejected = 0;
  const failed = [];

  for (const raw of csvFiles) {
    const fileName = path.basename(raw);
    const tableName = getTableName(fileName);
    if (!tableName) { console.warn(`Skipping ${fileName}: unknown file type`); continue; }

    process.stdout.write(`Processing ${fileName} -> ${tableName} ... `);
    const cleanPath = path.join(args.cleanDir, fileName);
    await cleanAndConvert(raw, cleanPath);

    let imported = 0, rejected = 0;
    try {
      ({ imported, rejected } = await importOne(conn, cleanPath, fileName, tableName, args.append));
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      failed.push(fileName);
    }
    totalImported += imported;
    totalRejected += rejected;

    await conn.run(
      `INSERT INTO import_summary (file_name, table_name, rows_imported, rows_rejected) VALUES ($1, $2, $3, $4)`,
      [fileName, tableName, imported, rejected]
    );
    console.log(`${imported} imported${rejected ? `, ${rejected} rejected` : ''}`);
  }

  console.log('\n==================================================');
  console.log('IMPORT COMPLETE');
  console.log(`Files processed: ${csvFiles.length}`);
  console.log(`Rows imported: ${totalImported.toLocaleString()}`);
  if (totalRejected) console.log(`Rows rejected: ${totalRejected.toLocaleString()}`);
  for (const t of ['vaersdata', 'vaerssymptoms', 'vaersvax']) {
    try {
      const c = Number((await conn.runAndReadAll(`SELECT COUNT(*)::BIGINT AS c FROM ${t}`)).getRowObjects()[0].c);
      console.log(`${t}: ${c.toLocaleString()} rows`);
    } catch { /* table may not exist */ }
  }
  console.log(`Database saved to: ${args.dbPath}`);

  conn.closeSync();
  instance.closeSync();

  // Fail loudly if any file failed — otherwise a partial import masquerades as
  // success and the model gets rebuilt over missing data.
  if (failed.length) {
    console.error(`\n✖ ${failed.length} file(s) FAILED: ${failed.join(', ')}`);
    console.error('  The database is INCOMPLETE — fix the input and re-run.');
    process.exit(1);
  }

  // After an incremental --append, the derived reports model is stale.
  if (args.append) {
    console.warn('\n⚠ reports model is now STALE. Rebuild it before serving:');
    console.warn('  bun pipeline/build.js --skip-import');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
