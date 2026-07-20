// Global filter state — one filter context shared by every view; any mutation
// reloads the ACTIVE view's panels + the cases table. Which panels those are
// (and which date axis the range binds to) is declared by the view via
// setActiveView; per-view display state (age detail, symptoms mode) stays in
// the view components themselves.
import { defineStore } from 'pinia'
import { fetchDashboard, fetchCases, fetchVaxTypes } from '../utils/api.js'

const PAGE_SIZE = 25

export const useFilterStore = defineStore('filters', {
  state: () => ({
    // filter context (persists across view switches, like Grafana variables)
    query: '',
    vaxTypes: [],         // multi-select; [] === All
    adhoc: [],            // [{ field, op, value }]
    dateFrom: '',
    dateTo: '',
    rate: 100,            // Grafana default (100 -> ×1, i.e. real counts)
    sort: { field: 'VAX_DATE', dir: 'desc' },

    // the active view's panel contract — set on route enter, reset on switch
    activeView: {
      name: '',
      panels: [],         // first-fetch panel keys
      lazyPanels: [],     // second-fetch keys (Vaccine's raw-join panels), after first paint
      dateField: 'VAX_DATE',   // 'VAX_DATE' | 'RECVDATE' — what dateFrom/dateTo bind to
      noVaxDateOnly: false,    // All Reports toggle (view-owned; reset on view enter)
    },

    // data — dashboard holds the union of panel keys fetched for the current
    // filter context; views read only their own keys.
    dashboard: null,
    cases: { rows: [], total: 0 },
    vaxTypeOptions: [],

    // paging + status
    page: 0,
    pageSize: PAGE_SIZE,
    loading: false,
    error: null,
    reqSeq: 0,
    booted: false,
  }),

  getters: {
    totalPages: (s) => Math.max(1, Math.ceil(s.cases.total / s.pageSize)),
    filterCtx: (s) => ({
      query: s.query, vaxTypes: s.vaxTypes, adhoc: s.adhoc,
      dateFrom: s.dateFrom, dateTo: s.dateTo, rate: s.rate, sort: s.sort,
      dateField: s.activeView.dateField, noVaxDateOnly: s.activeView.noVaxDateOnly,
    }),
  },

  actions: {
    // One-time boot (vax-type dropdown options). Reloads are driven by setActiveView.
    async init() {
      if (this.booted) return
      this.booted = true
      try { this.vaxTypeOptions = await fetchVaxTypes() } catch (e) { console.warn('vax-types load failed', e) }
    },

    // Called by each view on mount. The filter context carries over in full;
    // only the panel list / date axis / toggle change.
    setActiveView({ name, panels, lazyPanels = [], dateField = 'VAX_DATE' }) {
      this.activeView = { name, panels, lazyPanels, dateField, noVaxDateOnly: false }
      return this.reload()
    },

    // All Reports' "No VAX_DATE only" — a query flag, so it lives on activeView
    // (the view owns the checkbox; a view switch resets it).
    setNoVaxDateOnly(v) {
      this.activeView.noVaxDateOnly = !!v
      return this.reload()
    },

    // Reload the active view's panels + cases for the current filter context.
    async reload({ resetPage = true } = {}) {
      const view = this.activeView
      if (!view.panels.length) return
      if (resetPage) this.page = 0
      const seq = ++this.reqSeq
      this.loading = true
      this.error = null
      try {
        const [dash, cases] = await Promise.all([
          fetchDashboard(this.filterCtx, view.panels),
          fetchCases(this.filterCtx, this.pageSize, this.page * this.pageSize),
        ])
        if (seq !== this.reqSeq) return // a newer request superseded this one
        this.dashboard = dash
        this.cases = cases
      } catch (e) {
        if (seq === this.reqSeq) this.error = e.message || 'Request failed'
        return
      } finally {
        if (seq === this.reqSeq) this.loading = false
      }
      // Second-phase fetch (Vaccine's vaersvax-join panels): after first paint, no
      // overlay — the missing keys render as per-panel "loading…" placeholders.
      if (view.lazyPanels.length) {
        try {
          const extra = await fetchDashboard(this.filterCtx, view.lazyPanels)
          if (seq === this.reqSeq) this.dashboard = { ...this.dashboard, ...extra }
        } catch (e) {
          if (seq === this.reqSeq) this.error = e.message || 'Request failed'
        }
      }
    },

    async setPage(page) {
      this.page = Math.min(Math.max(page, 0), this.totalPages - 1)
      const seq = ++this.reqSeq
      this.loading = true
      this.error = null
      try {
        const cases = await fetchCases(this.filterCtx, this.pageSize, this.page * this.pageSize)
        if (seq === this.reqSeq) this.cases = cases
      } catch (e) {
        if (seq === this.reqSeq) this.error = e.message || 'Request failed'
      } finally {
        if (seq === this.reqSeq) this.loading = false
      }
    },

    // ---- filter mutations (each triggers a full reload) ----
    setQuery(v)     { this.query = v;    return this.reload() },
    setVaxTypes(v)  { this.vaxTypes = Array.isArray(v) ? v : []; return this.reload() },
    setDateRange(from, to) { this.dateFrom = from || ''; this.dateTo = to || ''; return this.reload() },
    setDateFrom(v)  { this.dateFrom = v; return this.reload() },
    setDateTo(v)    { this.dateTo = v;   return this.reload() },
    setRate(v)      { this.rate = Number(v); return this.reload() },

    addAdhoc()        { this.adhoc.push({ field: 'STATE', op: '=', value: '' }) },
    removeAdhoc(i)    { this.adhoc.splice(i, 1); return this.reload() },
    applyAdhoc()      { return this.reload() },

    // Click-to-filter: REPLACE any existing adhoc rows on the same field(s), then append
    // the new rows, then a single reload (repeated bucket clicks must not accumulate
    // contradictory bounds).
    addFilters(rows) {
      const fields = new Set(rows.map((r) => r.field))
      this.adhoc = this.adhoc.filter((a) => !fields.has(a.field))
      this.adhoc.push(...rows)
      return this.reload()
    },

    // Cases-only refetch: same field flips direction, new field defaults to desc.
    async setSort(field) {
      this.sort = this.sort.field === field
        ? { field, dir: this.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'desc' }
      this.page = 0
      const seq = ++this.reqSeq
      this.loading = true
      this.error = null
      try {
        const cases = await fetchCases(this.filterCtx, this.pageSize, this.page * this.pageSize)
        if (seq === this.reqSeq) this.cases = cases
      } catch (e) {
        if (seq === this.reqSeq) this.error = e.message || 'Request failed'
      } finally {
        if (seq === this.reqSeq) this.loading = false
      }
    },

    reset() {
      this.query = ''; this.vaxTypes = []; this.adhoc = []
      this.dateFrom = ''; this.dateTo = ''; this.rate = 100
      this.sort = { field: 'VAX_DATE', dir: 'desc' }
      this.activeView.noVaxDateOnly = false
      return this.reload()
    },
  },
})
