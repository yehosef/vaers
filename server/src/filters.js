// Global filter state -> { where, params } against the `reports` table (alias r).
//
// Filter context (shared by /api/dashboard and /api/cases):
//   query      free-text -> SYMPTOM_TEXT ILIKE %query%
//   vax_type   single VAX_TYPE  -> list_contains(VAX_TYPES, ?)
//   date_from  VAX_DATE >= ?    (the dashboard time dimension is VAX_DATE)
//   date_to    VAX_DATE <= ?
//   adhoc[]    whitelisted {field, op, value} only — everything else rejected
//   rate       NOT a filter; a count multiplier handled in the routes (×100/rate)

// Scalar columns that may be filtered ad hoc, with the operators each allows.
const SCALAR_FIELDS = {
  STATE: 'str', SEX: 'str', DIED: 'str', L_THREAT: 'str', HOSPITAL: 'str',
  DISABLE: 'str', RECOVD: 'str', ER_VISIT: 'str', ER_ED_VISIT: 'str', X_STAY: 'str',
  BIRTH_DEFECT: 'str', OFC_VISIT: 'str', V_ADMINBY: 'str', V_FUNDBY: 'str',
  AGE_YRS: 'num', NUMDAYS: 'num', NUM_VAX: 'num', IS_DOMESTIC: 'bool',
};
// List columns — membership via list_contains.
const LIST_FIELDS = new Set(['REACTIONS', 'VAX_TYPES', 'HAS_DATA']);

const SCALAR_OPS = new Set(['=', '!=', '>', '<', '>=', '<=']);
const LIST_OPS = new Set(['=', '!=']);

export function buildFilters(body = {}) {
  const conds = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (body.query && String(body.query).trim() && String(body.query).trim() !== '*') {
    conds.push(`r.SYMPTOM_TEXT ILIKE ${p('%' + String(body.query).trim() + '%')}`);
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

  if (body.date_from) conds.push(`r.VAX_DATE >= ${p(String(body.date_from))}`);
  if (body.date_to)   conds.push(`r.VAX_DATE <= ${p(String(body.date_to))}`);

  for (const f of Array.isArray(body.adhoc) ? body.adhoc : []) {
    if (!f || typeof f.field !== 'string') continue;
    const field = f.field.toUpperCase();
    const op = String(f.op || '=');

    if (LIST_FIELDS.has(field)) {
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
