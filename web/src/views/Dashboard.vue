<template>
  <div class="dash">
    <!-- ===== Filter bar ===== -->
    <div class="filterbar">
      <div class="fb-left">
        <div class="grp">
          <label class="lbl">query</label>
          <input class="inp query" type="text" placeholder="* · text · or VAERS ID"
                 v-model="queryDraft"
                 @keyup.enter="store.setQuery(queryDraft)" @blur="store.setQuery(queryDraft)" />
        </div>
        <VaxTypeSelect :options="store.vaxTypeOptions" :model-value="store.vaxTypes"
                       @change="store.setVaxTypes($event)" />
        <div class="grp adhoc-add">
          <label class="lbl">adhoc</label>
          <button class="plus" @click="store.addAdhoc()">＋</button>
        </div>
      </div>
      <div class="fb-right">
        <DateRange :from="store.dateFrom" :to="store.dateTo" @change="(f,t) => store.setDateRange(f,t)" />
        <div class="grp">
          <label class="lbl">rate</label>
          <select class="inp" :value="store.rate" @change="store.setRate($event.target.value)">
            <option v-for="r in rateOptions" :key="r" :value="r">{{ r }} (×{{ 100 / r }})</option>
          </select>
        </div>
        <button class="btn" @click="onReset">Reset</button>
        <span v-if="store.loading" class="loading">updating…</span>
        <span v-if="store.error" class="err">{{ store.error }}</span>
      </div>
    </div>

    <!-- ===== Adhoc filter rows ===== -->
    <div class="adhoc" v-if="store.adhoc.length">
      <AdhocRow v-for="(a, i) in store.adhoc" :key="i" :row="a" :fields="adhocFields"
                @apply="store.applyAdhoc()" @remove="store.removeAdhoc(i)" />
      <button class="btn sm apply" @click="store.applyAdhoc()">apply</button>
    </div>

    <div class="content">
    <template v-if="store.dashboard">
      <!-- ===== Row 2: VAERS EVENTS | Total | Onset day ===== -->
      <div class="grid">
        <div class="panel c6"><div class="ptitle">VAERS EVENTS</div><div ref="yearEl" class="pbody"></div></div>
        <div class="panel c2 stat">
          <div class="ptitle">Total</div>
          <div class="stat-value">{{ statVal(store.dashboard.total) }}</div>
          <div ref="sparkEl" class="spark"></div>
        </div>
        <div class="panel c4"><div class="ptitle">Onset day</div><div ref="onsetEl" class="pbody"></div></div>
      </div>

      <!-- ===== Row 3: Vax Types | Num Vacc. | Reactions | Age ===== -->
      <div class="grid">
        <div class="panel c3">
          <div class="ptitle">Vax Types</div>
          <table class="tbl">
            <thead><tr><th>VAX.TYPE</th><th class="num">Total</th></tr></thead>
            <tbody>
              <tr v-for="v in store.dashboard.vax_types" :key="v.vax_type">
                <td>{{ v.vax_type }}</td><td class="num">{{ fmt(v.count) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="panel c3"><div class="ptitle">Num Vacc.</div><div ref="numVaxEl" class="pbody"></div></div>
        <div class="panel c2">
          <div class="ptitle">Reactions</div>
          <div class="pie-wrap">
            <div ref="pieEl"></div>
            <ul class="legend">
              <li v-for="(r, i) in store.dashboard.reactions" :key="r.reaction" class="clickable" @click="onReactionClick(r)">
                <span class="dot" :style="{ background: palette[i % palette.length] }"></span>{{ r.reaction }}
              </li>
            </ul>
          </div>
        </div>
        <div class="panel c4">
          <div class="ptitle phead">
            <span>{{ store.ageDetail ? 'Age (<20)' : 'Age' }}</span>
            <button class="pill" :class="{ on: store.ageDetail }"
                    @click="store.setAgeDetail(!store.ageDetail)" title="toggle single-year &lt;20 detail">&lt;20</button>
          </div>
          <div ref="ageEl" class="pbody"></div>
        </div>
      </div>

      <!-- ===== Row 4: Symptoms | Manufacturers | Sex | State ===== -->
      <div class="grid">
        <div class="panel c4">
          <div class="ptitle">Symptoms <span class="muted small">· {{ symptomsCaption }}</span></div>
          <div ref="symptomsEl" class="pbody"></div>
        </div>
        <div class="panel c3">
          <div class="ptitle">Manufacturers</div>
          <table class="tbl">
            <thead><tr><th>MANUFACTURER</th><th class="num">Total</th></tr></thead>
            <tbody>
              <tr v-for="m in store.dashboard.manufacturers" :key="m.manu" class="crow" @click="onManuClick(m.manu)">
                <td>{{ m.manu }}</td><td class="num">{{ fmt(m.count) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="panel c2">
          <div class="ptitle">Sex</div>
          <div class="pie-wrap">
            <div ref="sexEl"></div>
            <ul class="legend">
              <li v-for="(s, i) in store.dashboard.sex" :key="s.sex" class="clickable" @click="onSexClick(s)">
                <span class="dot" :style="{ background: palette[i % palette.length] }"></span>{{ s.sex }}
              </li>
            </ul>
          </div>
        </div>
        <div class="panel c3">
          <div class="ptitle">State</div>
          <table class="tbl">
            <thead><tr><th>STATE</th><th class="num">Total</th></tr></thead>
            <tbody>
              <tr v-for="st in store.dashboard.states" :key="st.state" class="crow" @click="onStateClick(st.state)">
                <td>{{ st.state }}</td><td class="num">{{ fmt(st.count) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="row-toggle">
        <button class="btn xs" @click="store.toggleExtra()">{{ store.showExtra ? 'less ▾' : 'more ▸' }}</button>
      </div>

      <!-- ===== Row 5 (toggleable): Deaths | Lag ===== -->
      <div class="grid" v-if="store.showExtra">
        <div class="panel c6">
          <div class="ptitle"
               title="Deaths by DATEDIED year; deaths lacking a death date are excluded; the VAX_DATE range filter still selects which cases appear.">
            Deaths
          </div>
          <div ref="deathsEl" class="pbody"></div>
          <div v-if="store.dashboard.deaths_missing_date" class="muted small ctr">
            {{ store.dashboard.deaths_missing_date }} deaths lack a death date (excluded)
          </div>
        </div>
        <div class="panel c6">
          <div class="ptitle">Report lag</div>
          <div ref="lagEl" class="pbody"></div>
        </div>
      </div>

      <!-- ===== Row 6: Case details ===== -->
      <div class="grid">
        <div class="panel c12">
          <div class="ptitle">Case details <span class="muted">· {{ store.cases.total.toLocaleString() }} reports</span></div>
          <table class="tbl cases">
            <thead>
              <tr>
                <th class="sortable" @click="store.setSort('VAX_DATE')">DATE <span class="arrow">{{ sortArrow('VAX_DATE') }}</span></th>
                <th class="num sortable" @click="store.setSort('AGE_YRS')">AGE <span class="arrow">{{ sortArrow('AGE_YRS') }}</span></th>
                <th class="num sortable" @click="store.setSort('NUMDAYS')">#DAYS <span class="arrow">{{ sortArrow('NUMDAYS') }}</span></th>
                <th>DESC</th>
                <th class="num sortable" @click="store.setSort('NUM_VAX')">#VAX <span class="arrow">{{ sortArrow('NUM_VAX') }}</span></th>
                <th class="ctr sortable" @click="store.setSort('FOLLOWUP_COUNT')">REPORTS <span class="arrow">{{ sortArrow('FOLLOWUP_COUNT') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in store.cases.rows" :key="row.VAERS_ID" class="crow" @click="openCase(row.VAERS_ID)">
                <td class="date">{{ row.VAX_DATE || '—' }}</td>
                <td class="num">{{ row.AGE_YRS ?? '—' }}</td>
                <td class="num">{{ row.NUMDAYS ?? '—' }}</td>
                <td class="desc" :title="row.SHORT_SYMPTOM_TEXT">{{ row.SHORT_SYMPTOM_TEXT }}</td>
                <td class="num vax"><span class="vaxcell" :style="vaxCellStyle(row.NUM_VAX)">{{ row.NUM_VAX }}</span></td>
                <td class="ctr">
                  <span v-if="row.FOLLOWUP_COUNT > 0" class="fu" :title="`${row.FOLLOWUP_COUNT} follow-up report(s)`">
                    +{{ row.FOLLOWUP_COUNT }} ↩
                  </span>
                  <span v-else class="muted">—</span>
                </td>
              </tr>
              <tr v-if="!store.cases.rows.length"><td colspan="6" class="muted center">no matching reports</td></tr>
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
      <div v-if="store.loading && store.dashboard" class="load-overlay">
        <div class="spinner"></div><span>Loading…</span>
      </div>
    </div>

    <CaseModal v-if="openId" :vaers-id="openId" @close="openId = null" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useFilterStore } from '../stores/filterStore.js'
import VaxTypeSelect from '../components/VaxTypeSelect.vue'
import DateRange from '../components/DateRange.vue'
import CaseModal from '../components/CaseModal.vue'
import AdhocRow from '../components/AdhocRow.vue'
import * as plots from '../utils/plots.js'

const store = useFilterStore()
const fmt = plots.fmt
const palette = plots.PALETTE

const rateOptions = [100, 50, 10, 5, 2, 1]
const adhocFields = ['FOLLOWUP_COUNT', 'STATE', 'SEX', 'DIED', 'HOSPITAL', 'L_THREAT', 'DISABLE', 'RECOVD',
  'ER_VISIT', 'ER_ED_VISIT', 'X_STAY', 'BIRTH_DEFECT', 'OFC_VISIT', 'V_ADMINBY', 'V_FUNDBY', 'AGE_YRS',
  'NUMDAYS', 'NUM_VAX', 'IS_DOMESTIC', 'REACTIONS', 'VAX_TYPES', 'HAS_DATA', 'SYMPTOMS', 'VAX_MANU']
const adhocOps = ['=', '!=', '>', '<', '>=', '<=']

const queryDraft = ref('')
const openId = ref(null)
const openCase = (id) => { openId.value = id }
const yearEl = ref(null), numVaxEl = ref(null), onsetEl = ref(null), ageEl = ref(null)
const pieEl = ref(null), sparkEl = ref(null)
const symptomsEl = ref(null), sexEl = ref(null), deathsEl = ref(null), lagEl = ref(null)

const statVal = (n) => (n >= 1e5 ? fmt(n) : n.toLocaleString())
function put(el, node) { if (el) el.replaceChildren(node) }

const symptomsCaption = computed(() => {
  const mode = store.dashboard?.symptoms?.mode
  return mode === 'significant' ? 'significant vs background' : 'top symptoms'
})

// Fixed 8 age buckets from the API → half-open [lo, hi) ranges; '60+' is a single-sided filter.
const AGE_BUCKET_RANGES = {
  '0-1': [0, 1], '1-2': [1, 2], '2-4': [2, 4], '4-10': [4, 10],
  '10-20': [10, 20], '20-40': [20, 40], '40-60': [40, 60],
}
function onAgeClick(d) {
  if (d.label === '60+') { store.addFilters([{ field: 'AGE_YRS', op: '>=', value: 60 }]); return }
  const range = AGE_BUCKET_RANGES[d.label]
  if (!range) return
  store.addFilters([
    { field: 'AGE_YRS', op: '>=', value: range[0] },
    { field: 'AGE_YRS', op: '<', value: range[1] },
  ])
}
function onAgeU20Click(d) {
  store.addFilters([
    { field: 'AGE_YRS', op: '>=', value: d.age },
    { field: 'AGE_YRS', op: '<', value: d.age + 1 },
  ])
}
function onReactionClick(d) { store.addFilters([{ field: 'REACTIONS', op: '=', value: d.reaction }]) }
function onSexClick(d) { store.addFilters([{ field: 'SEX', op: '=', value: d.sex }]) }
function onSymptomClick(d) { store.addFilters([{ field: 'SYMPTOMS', op: '=', value: d.symptom }]) }
function onManuClick(manu) { store.addFilters([{ field: 'VAX_MANU', op: '=', value: manu }]) }
function onStateClick(state) { store.addFilters([{ field: 'STATE', op: '=', value: state }]) }

function sortArrow(field) {
  if (store.sort.field !== field) return ''
  return store.sort.dir === 'asc' ? '▲' : '▼'
}

function render() {
  const d = store.dashboard
  if (!d) return
  const w = (el) => Math.max(el?.clientWidth || 320, 160)
  put(yearEl.value, plots.eventsByYear(d.events_by_year, w(yearEl.value)))
  put(numVaxEl.value, plots.numVax(d.num_vax, w(numVaxEl.value)))
  put(onsetEl.value, plots.onsetDays(d.onset_days, w(onsetEl.value)))
  put(ageEl.value, store.ageDetail
    ? plots.ageU20(d.age_u20, w(ageEl.value), 210, onAgeU20Click)
    : plots.ageBuckets(d.age, w(ageEl.value), 210, onAgeClick))
  put(pieEl.value, plots.reactionsPie(d.reactions, onReactionClick))
  put(sparkEl.value, plots.sparkline(d.sparkline))
  put(symptomsEl.value, plots.symptomsBar(
    d.symptoms?.rows || [], d.symptoms?.mode || 'top', w(symptomsEl.value), 300, onSymptomClick))
  put(sexEl.value, plots.sexPie(d.sex, onSexClick))
  if (store.showExtra) {
    if (d.deaths) put(deathsEl.value, plots.deathsByYear(d.deaths, w(deathsEl.value)))
    put(lagEl.value, plots.lagBins(d.lag, w(lagEl.value)))
  }
}

// #VAX cell: green(1-2) → amber → orange → red, matching Grafana thresholds.
function vaxCellStyle(n) {
  const bg = n >= 6 ? '#890f02' : n >= 5 ? '#bf1b00' : n >= 4 ? '#ef843c'
    : n >= 3 ? '#e0b400' : ''
  return bg ? { background: bg, color: '#fff' } : {}
}

function onReset() { queryDraft.value = ''; store.reset() }

watch(() => store.dashboard, () => nextTick(render))
watch(() => store.showExtra, () => nextTick(render))
watch(() => store.ageDetail, () => nextTick(render))
let raf = null
onMounted(async () => {
  await store.init()
  await nextTick(); render()
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => nextTick(render)) })
})
</script>

<style scoped>
.dash { color: #d8d9da; }

/* filter bar */
.filterbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; }
.fb-left, .fb-right { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.grp { display: flex; align-items: center; gap: 8px; }
.lbl { color: #33b5e5; font-size: 12px; font-weight: 600; }
.inp { background: #0b0c0e; color: #d8d9da; border: 1px solid #2c2f36; border-radius: 3px; padding: 6px 8px; font-size: 13px; color-scheme: dark; }
.inp.query { width: 200px; } .inp.sm { width: 150px; } .inp.xs { width: 64px; }
.inp:focus { outline: none; border-color: #33b5e5; box-shadow: 0 0 0 1px #33b5e5; }
.plus { width: 30px; height: 30px; background: #2c3235; border: 1px solid #3a4147; color: #d8d9da; border-radius: 3px; cursor: pointer; font-size: 15px; }
.plus:hover { background: #3a4147; }
.btn { background: #2c3235; color: #d8d9da; border: 1px solid #3a4147; border-radius: 3px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.btn:hover { background: #3a4147; } .btn.xs { padding: 4px 8px; font-size: 12px; } .btn.sm { padding: 5px 10px; }
.btn.apply { background: #33b5e5; border-color: #33b5e5; color: #06131a; font-weight: 600; }
.btn:disabled { opacity: .4; cursor: default; }
.loading { color: #e0b400; font-size: 12px; } .err { color: #e02f44; font-size: 12px; }

/* adhoc rows */
.adhoc { display: flex; gap: 8px; align-items: center; padding: 8px 10px; margin-bottom: 12px; flex-wrap: wrap; background: #1f2126; border: 1px solid #2c2f36; border-radius: 3px; }
.adhoc-row { display: flex; gap: 4px; align-items: center; }

/* grid */
.grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 8px; margin-bottom: 8px; }
.c2 { grid-column: span 2; } .c3 { grid-column: span 3; } .c4 { grid-column: span 4; }
.c6 { grid-column: span 6; } .c12 { grid-column: span 12; }
.panel { background: #141619; border: 1px solid #23262b; border-radius: 3px; padding: 8px 10px; min-width: 0; }
.ptitle { text-align: center; font-size: 13px; color: #d8d9da; font-weight: 500; margin-bottom: 6px; }
.ptitle.phead { display: flex; align-items: center; justify-content: center; gap: 6px; }
.pbody { overflow: hidden; }
.stat { display: flex; flex-direction: column; }
.stat-value { text-align: center; font-size: 30px; font-weight: 700; color: #fff; margin: 12px 0 4px; }
.spark { margin-top: auto; }
.small { font-size: 11px; }
.ctr { text-align: center; }

/* small toggle pill (Age <20) */
.pill { font-size: 10px; padding: 1px 7px; border-radius: 9px; border: 1px solid #3a4147; background: #2c3235; color: #8e8e8e; cursor: pointer; line-height: 1.5; }
.pill:hover { color: #d8d9da; } .pill.on { background: #33b5e5; border-color: #33b5e5; color: #06131a; }

/* more/less row toggle */
.row-toggle { display: flex; justify-content: center; margin: -2px 0 8px; }

/* pie */
.pie-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.legend { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1px 8px; width: 100%; font-size: 10px; }
.legend li { display: flex; align-items: center; gap: 4px; color: #b8bcc2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.legend li.clickable { cursor: pointer; }
.legend li.clickable:hover { color: #fff; }
.dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 auto; }

/* tables */
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; color: #33b5e5; font-weight: 500; border-bottom: 1px solid #2c2f36; padding: 5px 6px; }
.tbl th.sortable { cursor: pointer; user-select: none; }
.tbl th.sortable:hover { color: #6ed0e0; }
.tbl th .arrow { font-size: 9px; }
.tbl td { padding: 4px 6px; border-bottom: 1px solid #1e2024; }
.tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl.cases .date { color: #33b5e5; white-space: nowrap; }
.tbl.cases .desc { max-width: 0; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c7cbd1; }
.tbl .crow { cursor: pointer; }
.tbl .crow:hover { background: #1c1f24; }
.tbl .ctr { text-align: center; white-space: nowrap; }
.fu { color: #e0b400; font-size: 11px; font-weight: 600; }
.vaxcell { display: inline-block; min-width: 20px; padding: 1px 6px; border-radius: 2px; font-weight: 700; }
.muted { color: #6b7078; font-weight: 400; } .center { text-align: center; }
.pager { display: flex; gap: 10px; align-items: center; justify-content: flex-end; margin-top: 8px; font-size: 12px; }
.booting { padding: 40px; text-align: center; color: #8e8e8e; }

/* loading overlay over the panels while a filter reload is in flight */
.content { position: relative; }
.load-overlay {
  position: absolute; inset: 0; z-index: 20; display: flex; align-items: flex-start;
  justify-content: center; gap: 10px; padding-top: 120px;
  background: rgba(11, 12, 14, 0.55); backdrop-filter: blur(1px);
  color: #d8d9da; font-size: 13px;
}
.load-overlay span { align-self: center; }
.spinner {
  width: 22px; height: 22px; border: 3px solid #2c3235; border-top-color: #33b5e5;
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1200px) {
  .grid { grid-template-columns: repeat(6, 1fr); }
  .c6, .c12 { grid-column: span 6; } .c4 { grid-column: span 6; } .c3 { grid-column: span 3; } .c2 { grid-column: span 2; }
}
</style>
