// Global filter state -> { where, params } against the `reports` table (alias r).
//
// Filter context (shared by /api/dashboard and /api/cases):
//   query           free-text -> SYMPTOM_TEXT ILIKE %query%
//   vax_type        single VAX_TYPE  -> list_contains(VAX_TYPES, ?)
//   date_field      which axis date_from/date_to bind to — 'VAX_DATE' (default) or
//                   'RECVDATE' (the All Reports view); strict whitelist, never interpolated raw
//   date_from       <date_field> >= ?
//   date_to         <date_field> <= ?
//   no_vaxdate_only true -> VAX_DATE IS NULL appended (All Reports view toggle)
//   adhoc[]         whitelisted {field, op, value} only — everything else rejected
//   rate            NOT a filter; a count multiplier handled in the routes (×100/rate)
import { all } from './db.js';

// Scalar columns that may be filtered ad hoc, with the operators each allows.
const SCALAR_FIELDS = {
  STATE: 'str', SEX: 'str', DIED: 'str', L_THREAT: 'str', HOSPITAL: 'str',
  DISABLE: 'str', RECOVD: 'str', ER_VISIT: 'str', ER_ED_VISIT: 'str', X_STAY: 'str',
  BIRTH_DEFECT: 'str', OFC_VISIT: 'str', V_ADMINBY: 'str', V_FUNDBY: 'str',
  AGE_YRS: 'num', NUMDAYS: 'num', NUM_VAX: 'num', FOLLOWUP_COUNT: 'num', IS_DOMESTIC: 'bool',
};
// List columns — membership via list_contains.
const LIST_FIELDS = new Set(['VAX_TYPES', 'HAS_DATA']);

// REACTIONS is no longer a stored list column — the 8 pseudo-values map to boolean
// predicates on the outcome columns. '!RECOVED' is the old "not recovered" pseudo-value.
const REACTION_PREDICATES = {
  DIED: "r.DIED='Y'", HOSPITAL: "r.HOSPITAL='Y'", L_THREAT: "r.L_THREAT='Y'",
  DISABLE: "r.DISABLE='Y'", ER_VISIT: "r.ER_VISIT='Y'", ER_ED_VISIT: "r.ER_ED_VISIT='Y'",
  X_STAY: "r.X_STAY='Y'", '!RECOVED': "r.RECOVD='N'",
};

const SCALAR_OPS = new Set(['=', '!=', '>', '<', '>=', '<=']);
const LIST_OPS = new Set(['=', '!=']);

// Classify a whitelisted adhoc field: 'num' | 'str' | 'bool' | 'list' | 'reaction' | 'symptom' | 'manu' | null.
export function classifyField(field) {
  const f = String(field || '').toUpperCase();
  if (f === 'REACTIONS') return 'reaction';
  if (f === 'SYMPTOMS') return 'symptom';
  if (f === 'VAX_MANU') return 'manu';
  if (LIST_FIELDS.has(f)) return 'list';
  return SCALAR_FIELDS[f] || null;
}

export async function buildFilters(body = {}) {
  const conds = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  const q = String(body.query ?? '').trim();
  if (q && q !== '*') {
    if (/^\d+$/.test(q)) {
      // all-digits -> exact VAERS_ID match, ignoring zero-padding (0025006 == 25006)
      conds.push(`TRY_CAST(r.VAERS_ID AS BIGINT) = TRY_CAST(${p(q)} AS BIGINT)`);
    } else {
      conds.push(`r.SYMPTOM_TEXT ILIKE ${p('%' + q + '%')}`);
    }
  }

  // VAX TYPE is multi-select (Grafana: multi=true, includeAll, allValue '*').
  // Several selected -> match reports having ANY of them (list_has_any / OR).
  const vaxTypes = []
    .concat(Array.isArray(body.vax_types) ? body.vax_types : [])
    .concat(body.vax_type ? [body.vax_type] : []) // legacy single value
    .map((v) => String(v).trim())
    .filter((v) => v && v !== '*' && v !== 'All');
  if (vaxTypes.length) {
    const list = vaxTypes.map((v) => p(v)).join(', ');
    conds.push(`list_has_any(r.VAX_TYPES, [${list}])`);
  }

  // date_field is an enum switch, not an interpolated value: anything but the exact
  // string 'RECVDATE' falls back to VAX_DATE.
  const dateField = String(body.date_field || '').toUpperCase() === 'RECVDATE' ? 'RECVDATE' : 'VAX_DATE';
  if (body.date_from) conds.push(`r.${dateField} >= ${p(String(body.date_from))}`);
  if (body.date_to)   conds.push(`r.${dateField} <= ${p(String(body.date_to))}`);

  // All Reports "No VAX_DATE only" toggle — restricts every panel + the cases table.
  if (body.no_vaxdate_only === true || body.no_vaxdate_only === 'true') {
    conds.push('r.VAX_DATE IS NULL');
  }

  for (const f of Array.isArray(body.adhoc) ? body.adhoc : []) {
    if (!f || typeof f.field !== 'string') continue;
    const field = f.field.toUpperCase();
    const op = String(f.op || '=');

    if (field === 'REACTIONS') {
      if (!LIST_OPS.has(op)) continue;
      // Object.hasOwn guards against inherited keys ("constructor", "toString") resolving
      // to a truthy non-predicate and getting stringified into the SQL.
      const pred = Object.hasOwn(REACTION_PREDICATES, String(f.value)) ? REACTION_PREDICATES[String(f.value)] : null;
      // Unknown pseudo-value: '=' matches nothing; '!=' ("cases NOT flagged <unknown>")
      // matches everything — pushing FALSE for both would wrongly empty the '!=' result.
      if (!pred) { conds.push(op === '!=' ? 'TRUE' : 'FALSE'); continue; }
      conds.push(op === '!=' ? `NOT COALESCE(${pred}, FALSE)` : pred);
    } else if (field === 'SYMPTOMS') {
      if (!LIST_OPS.has(op)) continue;
      // Case-insensitive dictionary resolution -> integer-correlated EXISTS against
      // reports_symptoms (SYMPTOM is not stored on reports itself). The dictionary is
      // case-sensitive, so one lowercased term can map to several ids (e.g.
      // "Factor XIII Inhibition"/"...inhibition") — match ALL of them, not an arbitrary one.
      const rows = await all('SELECT SYMPTOM_ID FROM symptoms WHERE lower(SYMPTOM) = lower($1)', [String(f.value)]);
      // Unresolvable term -> '=' matches nothing; '!=' matches everything (see REACTIONS).
      if (!rows.length) { conds.push(op === '!=' ? 'TRUE' : 'FALSE'); continue; }
      const idList = rows.map((r) => p(r.SYMPTOM_ID)).join(', ');
      const expr = `EXISTS (SELECT 1 FROM reports_symptoms rs WHERE rs.VAERS_ID = r.VAERS_ID AND rs.SYMPTOM_ID IN (${idList}))`;
      conds.push(op === '!=' ? `NOT ${expr}` : expr);
    } else if (field === 'VAX_MANU') {
      if (!LIST_OPS.has(op)) continue;
      const val = p(String(f.value));
      const expr = `EXISTS (SELECT 1 FROM reports_vax rv WHERE rv.VAERS_ID = r.VAERS_ID AND rv.VAX_MANU = ${val})`;
      conds.push(op === '!=' ? `NOT ${expr}` : expr);
    } else if (LIST_FIELDS.has(field)) {
      if (!LIST_OPS.has(op)) continue;
      const expr = `list_contains(r.${field}, ${p(String(f.value))})`;
      conds.push(op === '!=' ? `NOT ${expr}` : expr);
    } else if (SCALAR_FIELDS[field]) {
      if (!SCALAR_OPS.has(op)) continue;
      const kind = SCALAR_FIELDS[field];
      let val = f.value;
      if (kind === 'num') { val = Number(val); if (Number.isNaN(val)) continue; }
      else if (kind === 'bool') { val = (val === true || val === 'true' || val === 1 || val === '1'); }
      else val = String(val);
      // The Sex panel bins NULL/'' into the 'U' slice, so a click on 'U' must select those
      // rows too — otherwise the drill-down total is smaller than the slice it came from.
      if (field === 'SEX' && val === 'U' && LIST_OPS.has(op)) {
        const merged = `(r.SEX = ${p('U')} OR r.SEX IS NULL OR r.SEX = '')`;
        conds.push(op === '!=' ? `NOT ${merged}` : merged);
        continue;
      }
      conds.push(`r.${field} ${op} ${p(val)}`);
    }
    // unknown field -> silently ignored (rejected)
  }

  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

// Multiplier that simulates underreporting: Grafana's sum(x1)*100/rate.
export function rateMultiplier(rate) {
  const r = Number(rate);
  if (!r || r <= 0) return 1;
  return 100 / r;
}
