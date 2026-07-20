// Global filter state — any mutation reloads all panels + the cases table.
import { defineStore } from 'pinia'
import { fetchDashboard, fetchCases, fetchVaxTypes } from '../utils/api.js'

const PAGE_SIZE = 25

export const useFilterStore = defineStore('filters', {
  state: () => ({
    // filter context
    query: '',
    vaxTypes: [],         // multi-select; [] === All
    adhoc: [],            // [{ field, op, value }]
    dateFrom: '',
    dateTo: '',
    rate: 100,            // Grafana default (100 -> ×1, i.e. real counts)
    sort: { field: 'VAX_DATE', dir: 'desc' },
    showExtra: false,     // row-5 display toggle (deaths + lag panels)
    ageDetail: false,     // Age panel display toggle (all-ages buckets vs. age_u20)

    // data
    dashboard: null,
    cases: { rows: [], total: 0 },
    vaxTypeOptions: [],

    // paging + status
    page: 0,
    pageSize: PAGE_SIZE,
    loading: false,
    error: null,
    reqSeq: 0,
  }),

  getters: {
    totalPages: (s) => Math.max(1, Math.ceil(s.cases.total / s.pageSize)),
    filterCtx: (s) => ({
      query: s.query, vaxTypes: s.vaxTypes, adhoc: s.adhoc,
      dateFrom: s.dateFrom, dateTo: s.dateTo, rate: s.rate,
      include_deaths: s.showExtra, sort: s.sort,
    }),
  },

  actions: {
    async init() {
      try { this.vaxTypeOptions = await fetchVaxTypes() } catch (e) { console.warn('vax-types load failed', e) }
      await this.reload()
    },

    // Reload every panel + cases for the current filter context.
    async reload({ resetPage = true } = {}) {
      if (resetPage) this.page = 0
      const seq = ++this.reqSeq
      this.loading = true
      this.error = null
      try {
        const [dash, cases] = await Promise.all([
          fetchDashboard(this.filterCtx),
          fetchCases(this.filterCtx, this.pageSize, this.page * this.pageSize),
        ])
        if (seq !== this.reqSeq) return // a newer request superseded this one
        this.dashboard = dash
        this.cases = cases
      } catch (e) {
        if (seq === this.reqSeq) this.error = e.message || 'Request failed'
      } finally {
        if (seq === this.reqSeq) this.loading = false
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

    // Dashboard-only refetch, only when turning ON; turning OFF just hides row 5.
    async toggleExtra() {
      this.showExtra = !this.showExtra
      if (!this.showExtra) return
      const seq = ++this.reqSeq
      this.loading = true
      this.error = null
      try {
        const dash = await fetchDashboard(this.filterCtx)
        if (seq === this.reqSeq) this.dashboard = dash
      } catch (e) {
        if (seq === this.reqSeq) this.error = e.message || 'Request failed'
      } finally {
        if (seq === this.reqSeq) this.loading = false
      }
    },

    setAgeDetail(v) { this.ageDetail = v }, // display-only; age_u20 always present

    reset() {
      this.query = ''; this.vaxTypes = []; this.adhoc = []
      this.dateFrom = ''; this.dateTo = ''; this.rate = 100
      this.sort = { field: 'VAX_DATE', dir: 'desc' }
      return this.reload()
    },
  },
})
