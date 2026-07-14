<template>
  <div class="dash">
    <!-- ===== Filter bar ===== -->
    <div class="filterbar">
      <div class="fb-item grow">
        <label>Query</label>
        <input class="inp" type="text" placeholder="search symptom text…"
               v-model="queryDraft" @keyup.enter="store.setQuery(queryDraft)" @blur="store.setQuery(queryDraft)" />
      </div>
      <div class="fb-item">
        <label>VAX TYPE</label>
        <select class="inp" :value="store.vaxType" @change="store.setVaxType($event.target.value)">
          <option value="">All</option>
          <option v-for="t in store.vaxTypeOptions" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>
      <div class="fb-item">
        <label>From (VAX_DATE)</label>
        <input class="inp" type="date" :value="store.dateFrom" @change="store.setDateFrom($event.target.value)" />
      </div>
      <div class="fb-item">
        <label>To</label>
        <input class="inp" type="date" :value="store.dateTo" @change="store.setDateTo($event.target.value)" />
      </div>
      <div class="fb-item">
        <label>Rate (underreporting)</label>
        <select class="inp" :value="store.rate" @change="store.setRate($event.target.value)">
          <option v-for="r in rateOptions" :key="r" :value="r">rate {{ r }} (×{{ 100 / r }})</option>
        </select>
      </div>
      <div class="fb-item">
        <label>&nbsp;</label>
        <button class="btn" @click="onReset">Reset</button>
      </div>
    </div>

    <!-- ===== Adhoc filter builder ===== -->
    <div class="adhoc">
      <span class="adhoc-label">Ad-hoc filters:</span>
      <div class="adhoc-row" v-for="(a, i) in store.adhoc" :key="i">
        <select class="inp sm" v-model="a.field"><option v-for="f in adhocFields" :key="f" :value="f">{{ f }}</option></select>
        <select class="inp xs" v-model="a.op"><option v-for="o in adhocOps" :key="o" :value="o">{{ o }}</option></select>
        <input class="inp sm" v-model="a.value" placeholder="value" @keyup.enter="store.applyAdhoc()" />
        <button class="btn xs" @click="store.removeAdhoc(i)">✕</button>
      </div>
      <button class="btn sm" @click="store.addAdhoc()">+ add</button>
      <button class="btn sm apply" v-if="store.adhoc.length" @click="store.applyAdhoc()">apply</button>
      <span v-if="store.loading" class="loading">updating…</span>
      <span v-if="store.error" class="err">{{ store.error }}</span>
    </div>

    <template v-if="store.dashboard">
      <!-- ===== Top row: Total + Events by year ===== -->
      <div class="grid">
        <div class="panel stat">
          <div class="panel-title">Total</div>
          <div class="stat-value">{{ store.dashboard.total.toLocaleString() }}</div>
          <div ref="sparkEl" class="spark"></div>
        </div>
        <div class="panel span3">
          <div class="panel-title">Vaccination Date</div>
          <div ref="yearEl"></div>
        </div>
      </div>

      <!-- ===== Middle row: Num vacc, Onset, Age, Reactions pie ===== -->
      <div class="grid g4">
        <div class="panel"><div class="panel-title">Num Vacc.</div><div ref="numVaxEl"></div></div>
        <div class="panel"><div class="panel-title">Onset day</div><div ref="onsetEl"></div></div>
        <div class="panel"><div class="panel-title">Age</div><div ref="ageEl"></div></div>
        <div class="panel">
          <div class="panel-title">Reactions</div>
          <div class="pie-wrap">
            <div ref="pieEl"></div>
            <ul class="legend">
              <li v-for="(r, i) in store.dashboard.reactions" :key="r.reaction">
                <span class="dot" :style="{ background: pieColors[i % pieColors.length] }"></span>
                {{ r.reaction }} <b>{{ fmt(r.count) }}</b>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- ===== Tables row ===== -->
      <div class="grid g2">
        <div class="panel">
          <div class="panel-title">Vax Types</div>
          <table class="tbl">
            <thead><tr><th>VAX TYPE</th><th class="num">Count</th></tr></thead>
            <tbody>
              <tr v-for="v in store.dashboard.vax_types" :key="v.vax_type">
                <td>{{ v.vax_type }}</td><td class="num">{{ v.count.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="panel">
          <div class="panel-title">Case details <span class="muted">({{ store.cases.total.toLocaleString() }} reports)</span></div>
          <table class="tbl cases">
            <thead><tr><th>DATE</th><th class="num">AGE</th><th class="num">#DAYS</th><th>DESC</th><th class="num">#VAX</th></tr></thead>
            <tbody>
              <tr v-for="row in store.cases.rows" :key="row.VAERS_ID">
                <td>{{ row.VAX_DATE || '—' }}</td>
                <td class="num">{{ row.AGE_YRS ?? '—' }}</td>
                <td class="num">{{ row.NUMDAYS ?? '—' }}</td>
                <td class="desc" :title="row.SHORT_SYMPTOM_TEXT">{{ row.SHORT_SYMPTOM_TEXT }}</td>
                <td class="num vax" :style="vaxCellStyle(row.NUM_VAX)">{{ row.NUM_VAX }}</td>
              </tr>
              <tr v-if="!store.cases.rows.length"><td colspan="5" class="muted center">no matching reports</td></tr>
            </tbody>
          </table>
          <div class="pager">
            <button class="btn xs" :disabled="store.page <= 0" @click="store.setPage(store.page - 1)">‹ prev</button>
            <span class="muted">page {{ store.page + 1 }} / {{ store.totalPages }}</span>
            <button class="btn xs" :disabled="store.page >= store.totalPages - 1" @click="store.setPage(store.page + 1)">next ›</button>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="booting">Loading dashboard…</div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import { useFilterStore } from '../stores/filterStore.js'
import * as plots from '../utils/plots.js'

const store = useFilterStore()
const fmt = plots.fmt
const pieColors = plots.PIE_COLORS

const rateOptions = [100, 50, 10, 5, 2, 1]
const adhocFields = ['STATE', 'SEX', 'DIED', 'HOSPITAL', 'L_THREAT', 'DISABLE', 'RECOVD', 'ER_VISIT',
  'ER_ED_VISIT', 'X_STAY', 'BIRTH_DEFECT', 'OFC_VISIT', 'V_ADMINBY', 'AGE_YRS', 'NUMDAYS', 'NUM_VAX',
  'IS_DOMESTIC', 'REACTIONS', 'VAX_TYPES', 'HAS_DATA']
const adhocOps = ['=', '!=', '>', '<', '>=', '<=']

const queryDraft = ref('')
const yearEl = ref(null), numVaxEl = ref(null), onsetEl = ref(null), ageEl = ref(null)
const pieEl = ref(null), sparkEl = ref(null)

function put(el, node) { if (el) { el.replaceChildren(node) } }

function render() {
  const d = store.dashboard
  if (!d) return
  const w = (el) => (el?.clientWidth || 360)
  put(yearEl.value, plots.eventsByYear(d.events_by_year, w(yearEl.value)))
  put(numVaxEl.value, plots.numVax(d.num_vax, w(numVaxEl.value)))
  put(onsetEl.value, plots.onsetDays(d.onset_days, w(onsetEl.value)))
  put(ageEl.value, plots.ageBuckets(d.age, w(ageEl.value)))
  put(pieEl.value, plots.reactionsPie(d.reactions))
  put(sparkEl.value, plots.sparkline(d.sparkline))
}

function vaxCellStyle(n) {
  const a = Math.min((n || 0) / 8, 1)
  return a > 0.12 ? { background: `rgba(224,47,68,${(a * 0.85).toFixed(2)})`, color: a > 0.5 ? '#fff' : '#d8d9da' } : {}
}

function onReset() { queryDraft.value = ''; store.reset() }

watch(() => store.dashboard, () => nextTick(render))
onMounted(async () => {
  await store.init()
  await nextTick(); render()
  window.addEventListener('resize', () => nextTick(render))
})
</script>

<style scoped>
.dash { color: #d8d9da; }
.filterbar, .adhoc { background: #1f2126; border: 1px solid #2c2f36; border-radius: 4px; }
.filterbar { display: flex; gap: 12px; padding: 12px; margin-bottom: 10px; flex-wrap: wrap; align-items: flex-end; }
.fb-item { display: flex; flex-direction: column; gap: 4px; }
.fb-item.grow { flex: 1 1 220px; }
.fb-item label { font-size: 11px; color: #8e8e8e; text-transform: uppercase; letter-spacing: .3px; }
.inp { background: #0b0c0e; color: #d8d9da; border: 1px solid #2c2f36; border-radius: 3px; padding: 6px 8px; font-size: 13px; }
.inp.sm { width: 150px; } .inp.xs { width: 64px; }
.btn { background: #2c3235; color: #d8d9da; border: 1px solid #3a4147; border-radius: 3px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.btn:hover { background: #3a4147; }
.btn.xs { padding: 4px 8px; font-size: 12px; } .btn.sm { padding: 5px 10px; }
.btn.apply { background: #3274d9; border-color: #3274d9; color: #fff; }
.btn:disabled { opacity: .4; cursor: default; }
.adhoc { display: flex; gap: 8px; align-items: center; padding: 8px 12px; margin-bottom: 14px; flex-wrap: wrap; }
.adhoc-label { font-size: 11px; color: #8e8e8e; text-transform: uppercase; }
.adhoc-row { display: flex; gap: 4px; align-items: center; }
.loading { color: #e0b400; font-size: 12px; } .err { color: #e02f44; font-size: 12px; }
.grid { display: grid; gap: 10px; margin-bottom: 10px; grid-template-columns: repeat(4, 1fr); }
.grid.g4 { grid-template-columns: repeat(4, 1fr); }
.grid.g2 { grid-template-columns: 1fr 1fr; }
.span3 { grid-column: span 3; } .stat { grid-column: span 1; }
.panel { background: #1f2126; border: 1px solid #2c2f36; border-radius: 4px; padding: 10px 12px; min-width: 0; }
.panel-title { font-size: 12px; color: #8e8e8e; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .3px; }
.stat-value { font-size: 34px; font-weight: 700; color: #fff; line-height: 1.1; }
.spark { margin-top: 8px; }
.pie-wrap { display: flex; gap: 10px; align-items: center; }
.pie-wrap > div:first-child { flex: 0 0 auto; }
.legend { list-style: none; font-size: 11px; margin: 0; padding: 0; }
.legend li { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; }
.legend b { margin-left: auto; color: #fff; }
.dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; color: #8e8e8e; font-weight: 600; border-bottom: 1px solid #2c2f36; padding: 5px 6px; }
.tbl td { padding: 4px 6px; border-bottom: 1px solid #26282d; }
.tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl.cases .desc { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #b8bcc2; }
.tbl .vax { font-weight: 700; border-radius: 2px; }
.muted { color: #6b7078; } .center { text-align: center; }
.pager { display: flex; gap: 10px; align-items: center; margin-top: 8px; font-size: 12px; }
.booting { padding: 40px; text-align: center; color: #8e8e8e; }
@media (max-width: 1100px) { .grid, .grid.g4 { grid-template-columns: repeat(2, 1fr); } .span3 { grid-column: span 2; } .grid.g2 { grid-template-columns: 1fr; } }
</style>
