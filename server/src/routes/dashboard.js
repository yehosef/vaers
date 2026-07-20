// Dashboard API — all panel aggregates in one round trip, plus paginated cases.
import express from 'express';
import { all, get, getDbPath } from '../db.js';
import { buildFilters, rateMultiplier, classifyField } from '../filters.js';

const router = express.Router();

const AGE_BUCKETS = ['0-1', '1-2', '2-4', '4-10', '10-20', '20-40', '40-60', '60+'];
const AGE_CASE = `CASE
  WHEN r.AGE_YRS >= 0  AND r.AGE_YRS < 1  THEN '0-1'
  WHEN r.AGE_YRS >= 1  AND r.AGE_YRS < 2  THEN '1-2'
  WHEN r.AGE_YRS >= 2  AND r.AGE_YRS < 4  THEN '2-4'
  WHEN r.AGE_YRS >= 4  AND r.AGE_YRS < 10 THEN '4-10'
  WHEN r.AGE_YRS >= 10 AND r.AGE_YRS < 20 THEN '10-20'
  WHEN r.AGE_YRS >= 20 AND r.AGE_YRS < 40 THEN '20-40'
  WHEN r.AGE_YRS >= 40 AND r.AGE_YRS < 60 THEN '40-60'
  WHEN r.AGE_YRS >= 60 THEN '60+'
END`;

// REACTIONS pseudo-values, in display order — see filters.js REACTION_PREDICATES.
const REACTION_LABELS = ['DIED', 'HOSPITAL', 'L_THREAT', 'DISABLE', 'ER_VISIT', 'ER_ED_VISIT', 'X_STAY', '!RECOVED'];
const LAG_BINS = ['<0', '0-7', '8-30', '31-90', '91-365', '366-730', '731+'];

// The dashboard's panel queries share one capped (550MB) DuckDB memory budget. Firing all
// ~14 at once lets several build large hash tables simultaneously on a broad filter (JLH
// significant-symptoms + the two reports_vax COUNT(DISTINCT) joins + the reactions scan),
// which overruns the limit and hard-OOMs the whole request. On the 550MB budget, holding
// concurrency at 1 reliably survives a broad filter: measured 18/18 vs 4/18 at 2, since
// two heavy hash-building queries overlapping already overrun it. Cost is near-zero — the
// light panels are sub-second run back-to-back and broad filters are dominated by one
// heavy query anyway (no-filter ~0.55s, COVID19 ~0.8s, worst broad EXISTS ~2.3s).
//
// The gate is PROCESS-GLOBAL, not per-request: two concurrent dashboards (multiple users,
// or rapid reloads whose superseded predecessors keep running — stale responses are
// discarded but not cancelled) would otherwise each run their own queue and overlap heavy
// queries through the shared pool + shared budget, recreating the OOM. A shared semaphore
// bounds total in-flight panel queries across ALL requests. Raise it (with VAERS_DB_MEMORY)
// on a larger VPS for more panel parallelism. Note it is silently capped by the connection
// pool size (VAERS_DB_POOL, default 4) — raise both together.
const PANEL_CONCURRENCY = Math.max(1, Number(process.env.VAERS_PANEL_CONCURRENCY) || 1);
let panelActive = 0;
const panelQueue = [];
function acquirePanelSlot() {
  if (panelActive < PANEL_CONCURRENCY) { panelActive++; return Promise.resolve(); }
  return new Promise((resolve) => panelQueue.push(resolve)); // slot transferred on release
}
function releasePanelSlot() {
  const next = panelQueue.shift();
  if (next) next();        // hand the held slot straight to the next waiter (count unchanged)
  else panelActive--;      // nobody waiting -> free the slot
}
// Run each thunk under the global gate, preserving input order in the results. Once one
// thunk fails the request is doomed (Promise.all rejects), so not-yet-started thunks skip
// their query instead of wasting the shared pool/budget after the response is already gone.
function runPanels(thunks) {
  let aborted = false;
  return Promise.all(thunks.map(async (thunk) => {
    await acquirePanelSlot();
    try {
      if (aborted) return undefined;
      return await thunk();
    } catch (e) {
      aborted = true;
      throw e;
    } finally {
      releasePanelSlot();
    }
  }));
}

// Run ONE query under the same global gate. /api/cases must share the panel
// budget: the dashboard and the cases table load in parallel on every filter
// change, and a SYMPTOMS-EXISTS cases query (SYMPTOM_TEXT projection) racing
// the JLH symptoms panel overruns the 550MB limit (measured hard OOM).
async function gated(fn) {
  await acquirePanelSlot();
  try { return await fn(); } finally { releasePanelSlot(); }
}

// ---------------------------------------------------------------------------
// Panel registry — POST /api/dashboard runs ONLY the requested panel keys.
//
// Each entry is a thunk builder: (ctx) => Promise<responseValue>, where ctx is
// the per-request filter context ({ where, params, and, scale, totalReact }).
// Keys are matched against this object verbatim and are NEVER interpolated into
// SQL — an unknown key is a 400, so the panels[] list is not attack surface.
// ---------------------------------------------------------------------------

// vaersvax raw-join panels (route/site/dose/lot): vaersvax has one row per vaccine
// per SUBMISSION, so both guards are load-bearing — COALESCE(REPORT_ORDER,1)=1 keeps
// the primary submission's vaccines only, and COUNT(DISTINCT VAERS_ID) collapses a
// case's multiple vaccine rows. `col` is a code literal from the registry, never input.
const vaxColPanel = (col, extra = '') => async (ctx) => {
  const rows = await all(
    `SELECT v.${col} AS label, COUNT(DISTINCT v.VAERS_ID)::BIGINT c
     FROM vaersvax v JOIN reports r ON r.VAERS_ID = v.VAERS_ID
     ${ctx.where} ${ctx.and} COALESCE(v.REPORT_ORDER, 1) = 1
       AND v.${col} IS NOT NULL AND trim(v.${col}) <> '' ${extra}
     GROUP BY 1 ORDER BY c DESC LIMIT 15`, ctx.params);
  return rows.map((r) => ({ label: r.label, count: ctx.scale(r.c) }));
};

const yearSeries = (rows, scale) => rows.map((r) => ({ year: r.y, count: scale(r.c) }));

const FOLLOWUP_BINS = ['0', '1', '2', '3-5', '6+'];

const PANEL_REGISTRY = {
  total: async (ctx) => ctx.scale((await ctx.totalReact()).total),

  reactions: async (ctx) => {
    const t = await ctx.totalReact();
    return REACTION_LABELS
      .map((reaction) => ({ reaction, count: ctx.scale(t[reaction]) }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  },

  events_by_year: async (ctx) => yearSeries(await all(
    `SELECT EXTRACT(year FROM r.VAX_DATE)::BIGINT y, COUNT(*)::BIGINT c
     FROM reports r ${ctx.where} ${ctx.and} r.VAX_DATE IS NOT NULL
     GROUP BY 1 ORDER BY 1`, ctx.params), ctx.scale),

  sparkline: async (ctx) => {
    const rows = await all(
      `SELECT strftime(date_trunc('month', r.VAX_DATE), '%Y-%m') period, COUNT(*)::BIGINT c
       FROM reports r ${ctx.where} ${ctx.and} r.VAX_DATE IS NOT NULL
       GROUP BY 1 ORDER BY 1`, ctx.params);
    return rows.map((r) => ({ period: r.period, count: ctx.scale(r.c) }));
  },

  onset_days: async (ctx) => {
    const rows = await all(
      `SELECT r.NUMDAYS::BIGINT d, COUNT(*)::BIGINT c
       FROM reports r ${ctx.where} ${ctx.and} r.NUMDAYS BETWEEN 0 AND 19
       GROUP BY 1 ORDER BY 1`, ctx.params);
    const m = new Map(rows.map((r) => [r.d, r.c]));
    return Array.from({ length: 20 }, (_, d) => ({ day: d, count: ctx.scale(m.get(d) || 0) }));
  },

  // reports_vax grain is (VAERS_ID, VAX_TYPE, VAX_MANU) -> count cases via COUNT(DISTINCT VAERS_ID).
  vax_types: async (ctx) => {
    const rows = await all(
      `SELECT rv.VAX_TYPE vax_type, COUNT(DISTINCT rv.VAERS_ID)::BIGINT c
       FROM reports_vax rv JOIN reports r ON r.VAERS_ID = rv.VAERS_ID ${ctx.where}
       GROUP BY 1 ORDER BY c DESC LIMIT 15`, ctx.params);
    return rows.map((r) => ({ vax_type: r.vax_type, count: ctx.scale(r.c) }));
  },

  num_vax: async (ctx) => {
    const rows = await all(
      `SELECT r.NUM_VAX::BIGINT n, COUNT(*)::BIGINT c
       FROM reports r ${ctx.where} ${ctx.and} r.NUM_VAX BETWEEN 1 AND 8
       GROUP BY 1 ORDER BY 1`, ctx.params);
    const m = new Map(rows.map((r) => [r.n, r.c]));
    return Array.from({ length: 8 }, (_, i) => ({ num: i + 1, count: ctx.scale(m.get(i + 1) || 0) }));
  },

  age: async (ctx) => {
    const rows = await all(
      `SELECT ${AGE_CASE} bucket, COUNT(*)::BIGINT c
       FROM reports r ${ctx.where} ${ctx.and} r.AGE_YRS IS NOT NULL
       GROUP BY 1`, ctx.params);
    const m = new Map(rows.map((r) => [r.bucket, r.c]));
    return AGE_BUCKETS.map((label) => ({ label, count: ctx.scale(m.get(label) || 0) }));
  },

  age_u20: async (ctx) => {
    const rows = await all(
      `SELECT floor(r.AGE_YRS)::BIGINT age, COUNT(*)::BIGINT c
       FROM reports r ${ctx.where} ${ctx.and} r.AGE_YRS >= 0 AND r.AGE_YRS < 20
       GROUP BY 1`, ctx.params);
    const m = new Map(rows.map((r) => [r.age, r.c]));
    return Array.from({ length: 20 }, (_, n) => ({ age: n, count: ctx.scale(m.get(n) || 0) }));
  },

  // Dual-mode: top-15 background symptoms when unfiltered (cheap: reads symptom_bg
  // only); significant-terms (JLH) scoring vs background once any filter is active.
  symptoms: async (ctx) => {
    if (ctx.where === '') {
      const rows = await all(
        `SELECT s.SYMPTOM AS symptom, b.bg_n AS c
         FROM symptom_bg b JOIN symptoms s USING (SYMPTOM_ID)
         ORDER BY b.bg_n DESC, s.SYMPTOM LIMIT 15`);
      return { mode: 'top', rows: rows.map((r) => ({ symptom: r.symptom, count: ctx.scale(r.c) })) };
    }
    // ${where} appears twice below (fg, ft) bound to the SAME params array — DuckDB
    // allows a positional param ($n) to be referenced more than once per statement.
    const rows = await all(
      `WITH fg AS (SELECT rs.SYMPTOM_ID, COUNT(*)::BIGINT fg_n FROM reports_symptoms rs
                   JOIN (SELECT VAERS_ID FROM reports r ${ctx.where}) f USING (VAERS_ID) GROUP BY 1),
            ft AS (SELECT COUNT(*)::DOUBLE n FROM reports r ${ctx.where}),
            bt AS (SELECT COUNT(*)::DOUBLE n FROM reports)
       SELECT s.SYMPTOM AS symptom, fg.fg_n, b.bg_n,
              ((fg.fg_n/ft.n) - (b.bg_n/bt.n)) * ((fg.fg_n/ft.n) / (b.bg_n/bt.n)) AS score
       FROM fg JOIN symptom_bg b USING (SYMPTOM_ID) JOIN symptoms s USING (SYMPTOM_ID)
       CROSS JOIN ft CROSS JOIN bt
       WHERE fg.fg_n >= 5 AND b.bg_n >= 25
         AND (fg.fg_n/ft.n) > (b.bg_n/bt.n)
       ORDER BY score DESC, fg.fg_n DESC, s.SYMPTOM LIMIT 10`, ctx.params);
    return {
      mode: 'significant',
      rows: rows.map((r) => ({
        symptom: r.symptom, fg_n: ctx.scale(r.fg_n), bg_n: ctx.scale(r.bg_n), score: r.score,
      })),
    };
  },

  // reports_vax grain is (VAERS_ID, VAX_TYPE, VAX_MANU) -> count cases via COUNT(DISTINCT VAERS_ID).
  manufacturers: async (ctx) => {
    const rows = await all(
      `SELECT rv.VAX_MANU AS manu, COUNT(DISTINCT rv.VAERS_ID)::BIGINT c
       FROM reports_vax rv JOIN reports r ON r.VAERS_ID = rv.VAERS_ID ${ctx.where}
       ${ctx.and} rv.VAX_MANU IS NOT NULL AND rv.VAX_MANU <> ''
       GROUP BY 1 ORDER BY c DESC LIMIT 10`, ctx.params);
    return rows.map((r) => ({ manu: r.manu, count: ctx.scale(r.c) }));
  },

  sex: async (ctx) => {
    const rows = await all(
      `SELECT COALESCE(NULLIF(r.SEX, ''), 'U') AS sex, COUNT(*)::BIGINT c FROM reports r
       ${ctx.where} GROUP BY 1 ORDER BY c DESC`, ctx.params);
    return rows.map((r) => ({ sex: r.sex, count: ctx.scale(r.c) }));
  },

  states: async (ctx) => {
    const rows = await all(
      `SELECT r.STATE AS state, COUNT(*)::BIGINT c FROM reports r
       ${ctx.where} ${ctx.and} r.STATE IS NOT NULL AND r.STATE <> ''
       GROUP BY 1 ORDER BY c DESC LIMIT 15`, ctx.params);
    return rows.map((r) => ({ state: r.state, count: ctx.scale(r.c) }));
  },

  lag: async (ctx) => {
    const rows = await all(
      `SELECT CASE
         WHEN date_diff('day', r.VAX_DATE, r.RECVDATE) < 0   THEN '<0'
         WHEN date_diff('day', r.VAX_DATE, r.RECVDATE) <= 7   THEN '0-7'
         WHEN date_diff('day', r.VAX_DATE, r.RECVDATE) <= 30  THEN '8-30'
         WHEN date_diff('day', r.VAX_DATE, r.RECVDATE) <= 90  THEN '31-90'
         WHEN date_diff('day', r.VAX_DATE, r.RECVDATE) <= 365 THEN '91-365'
         WHEN date_diff('day', r.VAX_DATE, r.RECVDATE) <= 730 THEN '366-730'
         ELSE '731+'
       END AS bucket, COUNT(*)::BIGINT c
       FROM reports r ${ctx.where} ${ctx.and}
         r.VAX_DATE IS NOT NULL AND r.RECVDATE IS NOT NULL
       GROUP BY 1`, ctx.params);
    const m = new Map(rows.map((r) => [r.bucket, r.c]));
    return LAG_BINS.map((bucket) => ({ bucket, count: ctx.scale(m.get(bucket) || 0) }));
  },

  // Deaths by DATEDIED year; deaths lacking a death date are reported separately.
  deaths: async (ctx) => {
    const rows = await all(
      `SELECT EXTRACT(year FROM r.DATEDIED)::BIGINT y, COUNT(*)::BIGINT c FROM reports r
       ${ctx.where} ${ctx.and} r.DIED = 'Y' GROUP BY 1 ORDER BY 1 NULLS FIRST`, ctx.params);
    const missing = rows.find((r) => r.y == null);
    return {
      rows: yearSeries(rows.filter((r) => r.y != null), ctx.scale),
      missing_date: ctx.scale(missing ? missing.c : 0),
    };
  },

  // Flat `reports` GROUP BYs — the cheapest panels here (7–35ms unconstrained).
  v_adminby: async (ctx) => {
    const rows = await all(
      `SELECT r.V_ADMINBY AS label, COUNT(*)::BIGINT c FROM reports r
       ${ctx.where} ${ctx.and} r.V_ADMINBY IS NOT NULL AND r.V_ADMINBY <> ''
       GROUP BY 1 ORDER BY c DESC LIMIT 15`, ctx.params);
    return rows.map((r) => ({ label: r.label, count: ctx.scale(r.c) }));
  },

  v_fundby: async (ctx) => {
    const rows = await all(
      `SELECT r.V_FUNDBY AS label, COUNT(*)::BIGINT c FROM reports r
       ${ctx.where} ${ctx.and} r.V_FUNDBY IS NOT NULL AND r.V_FUNDBY <> ''
       GROUP BY 1 ORDER BY c DESC LIMIT 15`, ctx.params);
    return rows.map((r) => ({ label: r.label, count: ctx.scale(r.c) }));
  },

  vax_route: vaxColPanel('VAX_ROUTE'),
  vax_site: vaxColPanel('VAX_SITE'),
  vax_dose_series: vaxColPanel('VAX_DOSE_SERIES'),
  // VAX_LOT is raw/uncleaned (269k distinct, ~29% NULL) — only the known junk
  // spellings are excluded; everything else is shown verbatim.
  vax_lot: vaxColPanel('VAX_LOT',
    "AND lower(trim(v.VAX_LOT)) NOT IN ('unk', 'unknown', 'no batch number')"),

  // GROUP BY the build-time VAX_COMBO column ('DTAPIPV::FLU4'); single-type cases
  // carry the bare type string, cases with no typed vaccine rows are NULL.
  vax_combos: async (ctx) => {
    const rows = await all(
      `SELECT r.VAX_COMBO AS label, COUNT(*)::BIGINT c FROM reports r
       ${ctx.where} ${ctx.and} r.VAX_COMBO IS NOT NULL
       GROUP BY 1 ORDER BY c DESC LIMIT 15`, ctx.params);
    return rows.map((r) => ({ label: r.label, count: ctx.scale(r.c) }));
  },

  // HAS_DATA's value set is static (the five history fields), so one FILTER-count
  // scan beats unnesting 2.7M list rows (measured: lateral UNNEST ≈ 4.9s, this ≈ 50ms).
  has_data: async (ctx) => {
    const fields = ['OTHER_MEDS', 'CUR_ILL', 'HISTORY', 'ALLERGIES', 'LAB_DATA'];
    const row = await get(
      `SELECT ${fields.map((f) => `COUNT(*) FILTER (WHERE list_contains(r.HAS_DATA, '${f}'))::BIGINT "${f}"`).join(', ')}
       FROM reports r ${ctx.where}`, ctx.params);
    return fields
      .map((f) => ({ label: f, count: ctx.scale(row[f]) }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  },

  // RECVDATE axis (All Reports view) — reports-only, no join.
  events_by_recvdate: async (ctx) => yearSeries(await all(
    `SELECT EXTRACT(year FROM r.RECVDATE)::BIGINT y, COUNT(*)::BIGINT c
     FROM reports r ${ctx.where} ${ctx.and} r.RECVDATE IS NOT NULL
     GROUP BY 1 ORDER BY 1`, ctx.params), ctx.scale),

  // Data Quality: arrival (RECVDATE) of the reports that lack a VAX_DATE.
  no_vaxdate_by_recvdate: async (ctx) => yearSeries(await all(
    `SELECT EXTRACT(year FROM r.RECVDATE)::BIGINT y, COUNT(*)::BIGINT c
     FROM reports r ${ctx.where} ${ctx.and} r.VAX_DATE IS NULL AND r.RECVDATE IS NOT NULL
     GROUP BY 1 ORDER BY 1`, ctx.params), ctx.scale),

  // pct is a ratio, so rate scaling cancels — reported unscaled.
  no_vaxdate_pct: async (ctx) => {
    const r = await get(
      `SELECT COUNT(*)::BIGINT total,
              COUNT(*) FILTER (WHERE r.VAX_DATE IS NULL)::BIGINT missing
       FROM reports r ${ctx.where}`, ctx.params);
    return {
      missing: ctx.scale(r.missing), total: ctx.scale(r.total),
      pct: Number(r.total) ? (Number(r.missing) / Number(r.total)) * 100 : 0,
    };
  },

  died_series: async (ctx) => yearSeries(await all(
    `SELECT EXTRACT(year FROM r.VAX_DATE)::BIGINT y, COUNT(*)::BIGINT c
     FROM reports r ${ctx.where} ${ctx.and} r.DIED = 'Y' AND r.VAX_DATE IS NOT NULL
     GROUP BY 1 ORDER BY 1`, ctx.params), ctx.scale),

  followup_dist: async (ctx) => {
    const rows = await all(
      `SELECT CASE
         WHEN r.FOLLOWUP_COUNT = 0 THEN '0'
         WHEN r.FOLLOWUP_COUNT = 1 THEN '1'
         WHEN r.FOLLOWUP_COUNT = 2 THEN '2'
         WHEN r.FOLLOWUP_COUNT <= 5 THEN '3-5'
         ELSE '6+'
       END AS bucket, COUNT(*)::BIGINT c
       FROM reports r ${ctx.where} GROUP BY 1`, ctx.params);
    const m = new Map(rows.map((r) => [r.bucket, r.c]));
    return FOLLOWUP_BINS.map((bucket) => ({ bucket, count: ctx.scale(m.get(bucket) || 0) }));
  },
};

// Bare requests (curl, older clients) with no panels[] get the Overview set.
const DEFAULT_PANELS = ['total', 'events_by_year', 'sparkline', 'onset_days', 'vax_types',
  'num_vax', 'age', 'age_u20', 'reactions', 'symptoms'];

// POST /api/dashboard — filter body + panels[] -> the requested aggregates (rate-scaled).
router.post('/dashboard', async (req, res) => {
  try {
    const body = req.body || {};
    const rawPanels = body.panels === undefined ? DEFAULT_PANELS : body.panels;
    if (!Array.isArray(rawPanels) || rawPanels.length === 0 || rawPanels.length > 40) {
      return res.status(400).json({ error: 'panels must be a non-empty array of panel keys' });
    }
    const panels = [...new Set(rawPanels.map((k) => String(k)))];
    const unknown = panels.filter((k) => !Object.hasOwn(PANEL_REGISTRY, k));
    if (unknown.length) {
      return res.status(400).json({ error: `unknown panel key(s): ${unknown.join(', ')}` });
    }

    const { where, params } = await buildFilters(body);
    const mult = rateMultiplier(body.rate);
    const scale = (n) => Math.round(Number(n) * mult);

    // Shared per-request context. totalReact memoizes the merged total+REACTIONS scan
    // so requesting both 'total' and 'reactions' costs one pass over reports; under the
    // serial gate the first thunk resolves it before the second one reads it.
    let totalReactP = null;
    const ctx = {
      where, params, scale,
      and: where ? 'AND' : 'WHERE',
      totalReact: () => (totalReactP ??= get(
        `SELECT COUNT(*)::BIGINT total,
           COUNT(*) FILTER (WHERE r.DIED='Y')::BIGINT DIED,
           COUNT(*) FILTER (WHERE r.HOSPITAL='Y')::BIGINT HOSPITAL,
           COUNT(*) FILTER (WHERE r.L_THREAT='Y')::BIGINT L_THREAT,
           COUNT(*) FILTER (WHERE r.DISABLE='Y')::BIGINT "DISABLE",
           COUNT(*) FILTER (WHERE r.ER_VISIT='Y')::BIGINT ER_VISIT,
           COUNT(*) FILTER (WHERE r.ER_ED_VISIT='Y')::BIGINT ER_ED_VISIT,
           COUNT(*) FILTER (WHERE r.X_STAY='Y')::BIGINT X_STAY,
           COUNT(*) FILTER (WHERE r.RECOVD='N')::BIGINT "!RECOVED"
         FROM reports r ${where}`, params)),
    };

    const values = await runPanels(panels.map((key) => () => PANEL_REGISTRY[key](ctx)));

    const response = { rate: Number(body.rate) || 1 };
    panels.forEach((key, i) => { response[key] = values[i]; });
    res.json(response);
  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases — same filters + pagination + sort -> case-details rows.
const SORT_FIELDS = new Set(['VAX_DATE', 'AGE_YRS', 'NUMDAYS', 'NUM_VAX', 'FOLLOWUP_COUNT', 'VAERS_ID']);
router.post('/cases', async (req, res) => {
  try {
    const { where, params } = await buildFilters(req.body || {});
    const limit = Math.min(Math.max(parseInt(req.body?.limit ?? 50, 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.body?.offset ?? 0, 10) || 0, 0);

    const reqField = String(req.body?.sort?.field || '').toUpperCase();
    const validField = SORT_FIELDS.has(reqField);
    const sortField = validField ? reqField : 'VAX_DATE';
    // An unrecognized field resets the whole sort to the default (VAX_DATE desc) rather
    // than applying the requested direction to the fallback column.
    const sortDir = validField && String(req.body?.sort?.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    // VAERS_ID is already the tiebreaker column -> no duplicate secondary sort needed.
    const orderBy = sortField === 'VAERS_ID'
      ? `TRY_CAST(r.VAERS_ID AS BIGINT) ${sortDir} NULLS LAST`
      : `r.${sortField} ${sortDir} NULLS LAST, TRY_CAST(r.VAERS_ID AS BIGINT) DESC`;

    const totalRow = await gated(() => get(`SELECT COUNT(*)::BIGINT c FROM reports r ${where}`, params));
    const rows = await gated(() => all(
      `SELECT r.VAERS_ID,
              strftime(r.VAX_DATE, '%Y-%m-%d') AS VAX_DATE,
              r.AGE_YRS, r.NUMDAYS, r.NUM_VAX::BIGINT NUM_VAX,
              r.FOLLOWUP_COUNT::BIGINT FOLLOWUP_COUNT,
              array_to_string(list_slice(string_split(coalesce(r.SYMPTOM_TEXT, ''), chr(10)), 1, 10), chr(10)) AS SHORT_SYMPTOM_TEXT
       FROM reports r ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ));

    res.json({
      rows, total: Number(totalRow.c), limit, offset,
      sort: { field: sortField, dir: sortDir.toLowerCase() },
    });
  } catch (err) {
    console.error('cases error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/field-values?field=STATE — describe a filterable field so the UI can pick
// the right value input (enum dropdown vs numeric range vs free text), like Grafana adhoc.
const VALUE_LIMIT = 200;
router.get('/field-values', async (req, res) => {
  try {
    const field = String(req.query.field || '').toUpperCase();
    const kind = classifyField(field); // validated whitelist -> safe to interpolate
    if (!kind) return res.status(400).json({ error: 'field not filterable' });

    if (kind === 'reaction') {
      // Static: REACTIONS is a fixed set of 8 pseudo-values mapped to boolean predicates.
      return res.json({
        field, kind: 'enum',
        values: ['DIED', 'HOSPITAL', 'L_THREAT', 'DISABLE', '!RECOVED', 'ER_VISIT', 'ER_ED_VISIT', 'X_STAY'],
      });
    }
    if (kind === 'symptom') {
      const rows = await all(`SELECT s.SYMPTOM FROM symptom_bg b JOIN symptoms s USING (SYMPTOM_ID)
                              ORDER BY b.bg_n DESC LIMIT 50`);
      return res.json({ field, kind: 'text', suggestions: rows.map((r) => r.SYMPTOM) });
    }
    if (kind === 'manu') {
      const rows = await all(`SELECT DISTINCT VAX_MANU FROM reports_vax
                              WHERE VAX_MANU IS NOT NULL AND VAX_MANU <> '' ORDER BY 1`);
      return res.json({ field, kind: 'enum', values: rows.map((r) => r.VAX_MANU) });
    }
    if (field === 'HAS_DATA') {
      // Static: HAS_DATA's five possible values never change — cheaper than unnesting.
      return res.json({ field, kind: 'enum', values: ['OTHER_MEDS', 'CUR_ILL', 'HISTORY', 'ALLERGIES', 'LAB_DATA'] });
    }
    if (kind === 'bool') {
      return res.json({ field, kind: 'enum', values: ['true', 'false'] });
    }
    if (kind === 'num') {
      const r = await get(`SELECT MIN(${field})::DOUBLE mn, MAX(${field})::DOUBLE mx,
                                  COUNT(DISTINCT ${field})::BIGINT d FROM reports`);
      const distinct = Number(r.d);
      // low-cardinality numerics (NUM_VAX, FOLLOWUP_COUNT) still get a value dropdown
      if (distinct > 0 && distinct <= 20) {
        const vals = await all(`SELECT DISTINCT ${field}::BIGINT v FROM reports
                                WHERE ${field} IS NOT NULL ORDER BY 1`);
        return res.json({ field, kind: 'numeric', min: r.mn, max: r.mx,
          values: vals.map((x) => x.v) });
      }
      return res.json({ field, kind: 'numeric', min: r.mn, max: r.mx, distinct });
    }
    if (kind === 'list') {
      // VAX_TYPES — the only remaining unnest-backed list field (HAS_DATA is static above).
      const rows = await all(`SELECT DISTINCT v FROM (SELECT unnest(${field}) v FROM reports)
                              WHERE v IS NOT NULL AND v <> '' ORDER BY 1 LIMIT 300`);
      return res.json({ field, kind: 'enum', values: rows.map((r) => r.v) });
    }
    // string
    const rows = await all(`SELECT DISTINCT ${field} v FROM reports
                            WHERE ${field} IS NOT NULL AND ${field} <> ''
                            ORDER BY 1 LIMIT ${VALUE_LIMIT + 1}`);
    if (rows.length > VALUE_LIMIT) return res.json({ field, kind: 'text' });
    return res.json({ field, kind: 'enum', values: rows.map((r) => r.v) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/case/:id — every report row for one case (primary + follow-ups) for the modal,
// plus its vaccines (vaersvax) and per-follow-up symptom lists (vaerssymptoms).
router.get('/case/:id', async (req, res) => {
  try {
    const reports = await all(
      `SELECT COALESCE(REPORT_ORDER, 1)::BIGINT AS REPORT_ORDER, IS_DOMESTIC,
              strftime(RECVDATE, '%Y-%m-%d')  AS RECVDATE,
              strftime(VAX_DATE, '%Y-%m-%d')  AS VAX_DATE,
              strftime(ONSET_DATE, '%Y-%m-%d') AS ONSET_DATE,
              strftime(DATEDIED, '%Y-%m-%d')  AS DATEDIED,
              AGE_YRS, SEX, STATE,
              -- NUMDAYS FIX: same cap/fallback as the reports model (build_reports.sql) —
              -- stored value >10000 -> NULL, else |ONSET_DATE - VAX_DATE| with the same cap.
              CASE
                WHEN NUMDAYS IS NOT NULL
                  THEN CASE WHEN NUMDAYS > 10000 THEN NULL ELSE NUMDAYS END
                WHEN VAX_DATE IS NOT NULL AND ONSET_DATE IS NOT NULL THEN
                  CASE WHEN abs(date_diff('day', VAX_DATE, ONSET_DATE)) > 10000 THEN NULL
                       ELSE abs(date_diff('day', VAX_DATE, ONSET_DATE)) END
                ELSE NULL
              END::BIGINT AS NUMDAYS,
              V_ADMINBY, V_FUNDBY, SPLTTYPE,
              DIED, L_THREAT, HOSPITAL, DISABLE, RECOVD, ER_VISIT, ER_ED_VISIT,
              SYMPTOM_TEXT,
              clean_null(OTHER_MEDS) AS OTHER_MEDS,
              clean_null(CUR_ILL)    AS CUR_ILL,
              clean_null(HISTORY)    AS HISTORY,
              clean_null(ALLERGIES)  AS ALLERGIES,
              clean_null(LAB_DATA)   AS LAB_DATA
       FROM vaersdata WHERE VAERS_ID = $1
       ORDER BY COALESCE(REPORT_ORDER, 1), FILE_LINE_NO`,
      [req.params.id]
    );

    const vaccines = await all(
      `SELECT COALESCE(REPORT_ORDER, 1)::BIGINT AS REPORT_ORDER, VAX_TYPE, VAX_NAME, VAX_MANU,
              VAX_LOT, VAX_DOSE_SERIES, VAX_ROUTE, VAX_SITE
       FROM vaersvax WHERE VAERS_ID = $1
       ORDER BY COALESCE(REPORT_ORDER, 1), FILE_LINE_NO`,
      [req.params.id]
    );

    const symptomRows = await all(
      `SELECT COALESCE(REPORT_ORDER, 1)::BIGINT AS REPORT_ORDER,
              SYMPTOM1, SYMPTOM2, SYMPTOM3, SYMPTOM4, SYMPTOM5
       FROM vaerssymptoms WHERE VAERS_ID = $1
       ORDER BY COALESCE(REPORT_ORDER, 1), FILE_LINE_NO`,
      [req.params.id]
    );
    // Flatten SYMPTOM1..5 per REPORT_ORDER, trim/drop empties/dedupe/sort — server-side
    // since a case can have several vaerssymptoms rows (multi-submission) per REPORT_ORDER.
    const byOrder = new Map();
    for (const row of symptomRows) {
      const set = byOrder.get(row.REPORT_ORDER) || new Set();
      for (const raw of [row.SYMPTOM1, row.SYMPTOM2, row.SYMPTOM3, row.SYMPTOM4, row.SYMPTOM5]) {
        const s = String(raw ?? '').trim();
        if (s) set.add(s);
      }
      byOrder.set(row.REPORT_ORDER, set);
    }
    const symptoms = [...byOrder.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([REPORT_ORDER, set]) => ({ REPORT_ORDER, symptoms: [...set].sort() }));

    res.json({ vaers_id: req.params.id, reports, vaccines, symptoms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/filters/vax-types — distinct vax types (frequency-ordered) for the dropdown.
router.get('/filters/vax-types', async (_req, res) => {
  try {
    // reports_vax grain is (VAERS_ID, VAX_TYPE, VAX_MANU) -> count cases via COUNT(DISTINCT VAERS_ID).
    const rows = await all(
      `SELECT VAX_TYPE, COUNT(DISTINCT VAERS_ID)::BIGINT c
       FROM reports_vax GROUP BY 1 ORDER BY c DESC LIMIT 500`
    );
    res.json({ vax_types: rows.map((r) => r.VAX_TYPE) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/status — health + basic counts.
router.get('/status', async (_req, res) => {
  try {
    const c = await get(`SELECT
      (SELECT COUNT(*)::BIGINT FROM reports) reports,
      (SELECT COUNT(*)::BIGINT FROM reports_vax) reports_vax`);
    res.json({ status: 'connected', db: getDbPath(), records: Number(c.reports), vax_rows: Number(c.reports_vax), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

export default router;
