// Global filter state — any mutation reloads all panels + the cases table.
import { defineStore } from 'pinia'
import { fetchDashboard, fetchCases, fetchVaxTypes } from '../utils/api.js'

const PAGE_SIZE = 25

export const useFilterStore = defineStore('filters', {
  state: () => ({
    // filter context
    query: '',
    vaxType: '',
    adhoc: [],            // [{ field, op, value }]
    dateFrom: '',
    dateTo: '',
    rate: 100,            // Grafana default (100 -> ×1, i.e. real counts)

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
      query: s.query, vaxType: s.vaxType, adhoc: s.adhoc,
      dateFrom: s.dateFrom, dateTo: s.dateTo, rate: s.rate,
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
      try {
        const cases = await fetchCases(this.filterCtx, this.pageSize, this.page * this.pageSize)
        if (seq === this.reqSeq) this.cases = cases
      } finally {
        if (seq === this.reqSeq) this.loading = false
      }
    },

    // ---- filter mutations (each triggers a full reload) ----
    setQuery(v)    { this.query = v;    return this.reload() },
    setVaxType(v)  { this.vaxType = v;  return this.reload() },
    setDateFrom(v) { this.dateFrom = v; return this.reload() },
    setDateTo(v)   { this.dateTo = v;   return this.reload() },
    setRate(v)     { this.rate = Number(v); return this.reload() },

    addAdhoc()        { this.adhoc.push({ field: 'STATE', op: '=', value: '' }) },
    removeAdhoc(i)    { this.adhoc.splice(i, 1); return this.reload() },
    applyAdhoc()      { return this.reload() },

    reset() {
      this.query = ''; this.vaxType = ''; this.adhoc = []
      this.dateFrom = ''; this.dateTo = ''; this.rate = 100
      return this.reload()
    },
  },
})
