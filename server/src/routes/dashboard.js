// Dashboard API — all 8 panel aggregates in one round trip, plus paginated cases.
import express from 'express';
import { all, get, getDbPath } from '../db.js';
import { buildFilters, rateMultiplier } from '../filters.js';

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

// POST /api/dashboard — filter body -> every panel aggregate (rate-scaled).
router.post('/dashboard', async (req, res) => {
  try {
    const { where, params } = buildFilters(req.body || {});
    const mult = rateMultiplier(req.body?.rate);
    const scale = (n) => Math.round(Number(n) * mult);

    const [totalRow, yearRows, monthRows, onsetRows, vaxRows, numVaxRows, reactionRows, ageRows] =
      await Promise.all([
        get(`SELECT COUNT(*)::BIGINT c FROM reports r ${where}`, params),
        all(`SELECT EXTRACT(year FROM r.VAX_DATE)::BIGINT y, COUNT(*)::BIGINT c
             FROM reports r ${where} ${where ? 'AND' : 'WHERE'} r.VAX_DATE IS NOT NULL
             GROUP BY 1 ORDER BY 1`, params),
        all(`SELECT strftime(date_trunc('month', r.VAX_DATE), '%Y-%m') period, COUNT(*)::BIGINT c
             FROM reports r ${where} ${where ? 'AND' : 'WHERE'} r.VAX_DATE IS NOT NULL
             GROUP BY 1 ORDER BY 1`, params),
        all(`SELECT r.NUMDAYS::BIGINT d, COUNT(*)::BIGINT c
             FROM reports r ${where} ${where ? 'AND' : 'WHERE'} r.NUMDAYS BETWEEN 0 AND 19
             GROUP BY 1 ORDER BY 1`, params),
        all(`SELECT rv.VAX_TYPE vax_type, COUNT(DISTINCT rv.VAERS_ID)::BIGINT c
             FROM reports_vax rv JOIN reports r ON r.VAERS_ID = rv.VAERS_ID ${where}
             GROUP BY 1 ORDER BY c DESC LIMIT 10`, params),
        all(`SELECT r.NUM_VAX::BIGINT n, COUNT(*)::BIGINT c
             FROM reports r ${where} ${where ? 'AND' : 'WHERE'} r.NUM_VAX BETWEEN 1 AND 8
             GROUP BY 1 ORDER BY 1`, params),
        all(`SELECT reaction, COUNT(*)::BIGINT c FROM (
               SELECT UNNEST(r.REACTIONS) reaction FROM reports r ${where}
             ) GROUP BY 1 ORDER BY c DESC LIMIT 10`, params),
        all(`SELECT ${AGE_CASE} bucket, COUNT(*)::BIGINT c
             FROM reports r ${where} ${where ? 'AND' : 'WHERE'} r.AGE_YRS IS NOT NULL
             GROUP BY 1`, params),
      ]);

    // Fill fixed-domain series so panels render a stable axis.
    const onsetMap = new Map(onsetRows.map((r) => [r.d, r.c]));
    const onset_days = Array.from({ length: 20 }, (_, d) => ({ day: d, count: scale(onsetMap.get(d) || 0) }));

    const numMap = new Map(numVaxRows.map((r) => [r.n, r.c]));
    const num_vax = Array.from({ length: 8 }, (_, i) => ({ num: i + 1, count: scale(numMap.get(i + 1) || 0) }));

    const ageMap = new Map(ageRows.map((r) => [r.bucket, r.c]));
    const age = AGE_BUCKETS.map((label) => ({ label, count: scale(ageMap.get(label) || 0) }));

    res.json({
      total: scale(totalRow.c),
      events_by_year: yearRows.map((r) => ({ year: r.y, count: scale(r.c) })),
      sparkline: monthRows.map((r) => ({ period: r.period, count: scale(r.c) })),
      onset_days,
      vax_types: vaxRows.map((r) => ({ vax_type: r.vax_type, count: scale(r.c) })),
      num_vax,
      reactions: reactionRows.map((r) => ({ reaction: r.reaction, count: scale(r.c) })),
      age,
      rate: Number(req.body?.rate) || 1,
    });
  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases — same filters + pagination -> case-details rows.
router.post('/cases', async (req, res) => {
  try {
    const { where, params } = buildFilters(req.body || {});
    const limit = Math.min(Math.max(parseInt(req.body?.limit ?? 50, 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.body?.offset ?? 0, 10) || 0, 0);

    const totalRow = await get(`SELECT COUNT(*)::BIGINT c FROM reports r ${where}`, params);
    const rows = await all(
      `SELECT r.VAERS_ID,
              strftime(r.VAX_DATE, '%Y-%m-%d') AS VAX_DATE,
              r.AGE_YRS, r.NUMDAYS, r.SHORT_SYMPTOM_TEXT, r.NUM_VAX::BIGINT NUM_VAX,
              r.FOLLOWUP_COUNT::BIGINT FOLLOWUP_COUNT
       FROM reports r ${where}
       ORDER BY r.VAX_DATE DESC NULLS LAST, r.VAERS_ID DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ rows, total: Number(totalRow.c), limit, offset });
  } catch (err) {
    console.error('cases error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/case/:id — every report row for one case (primary + follow-ups) for the modal.
router.get('/case/:id', async (req, res) => {
  try {
    const reports = await all(
      `SELECT COALESCE(REPORT_ORDER, 1)::BIGINT AS REPORT_ORDER, IS_DOMESTIC,
              strftime(RECVDATE, '%Y-%m-%d')  AS RECVDATE,
              strftime(VAX_DATE, '%Y-%m-%d')  AS VAX_DATE,
              strftime(ONSET_DATE, '%Y-%m-%d') AS ONSET_DATE,
              AGE_YRS, SEX, STATE, NUMDAYS::BIGINT NUMDAYS,
              V_ADMINBY, V_FUNDBY, SPLTTYPE,
              DIED, L_THREAT, HOSPITAL, DISABLE, RECOVD, ER_VISIT, ER_ED_VISIT,
              SYMPTOM_TEXT
       FROM vaersdata WHERE VAERS_ID = $1
       ORDER BY COALESCE(REPORT_ORDER, 1), FILE_LINE_NO`,
      [req.params.id]
    );
    res.json({ vaers_id: req.params.id, reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/filters/vax-types — distinct vax types (frequency-ordered) for the dropdown.
router.get('/filters/vax-types', async (_req, res) => {
  try {
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
