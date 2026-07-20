<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="mhead">
        <div>
          <span class="mid">VAERS ID {{ vaersId }}</span>
          <span class="mcount">{{ reports.length }} report{{ reports.length === 1 ? '' : 's' }}
            <template v-if="reports.length > 1">· 1 primary + {{ reports.length - 1 }} follow-up</template>
          </span>
        </div>
        <button class="x" @click="$emit('close')">✕</button>
      </div>

      <div class="mbody">
        <div v-if="loading" class="state">loading…</div>
        <div v-else-if="error" class="state err">{{ error }}</div>
        <div v-else v-for="r in reports" :key="r.REPORT_ORDER" class="report">
          <div class="rhead">
            <span class="badge" :class="{ primary: r.REPORT_ORDER === 1 }">
              {{ r.REPORT_ORDER === 1 ? 'PRIMARY' : `FOLLOW-UP #${r.REPORT_ORDER - 1}` }}
            </span>
            <span class="rmeta">received {{ r.RECVDATE || '—' }}</span>
            <span v-if="r.SPLTTYPE" class="rmeta">· split {{ r.SPLTTYPE }}</span>
            <span v-if="r.V_ADMINBY" class="rmeta">· admin {{ r.V_ADMINBY }}</span>
          </div>
          <div class="rfields">
            <span>vax date <b>{{ r.VAX_DATE || '—' }}</b></span>
            <span>onset <b>{{ r.ONSET_DATE || '—' }}</b></span>
            <span>#days <b>{{ r.NUMDAYS ?? '—' }}</b></span>
            <span>age <b>{{ r.AGE_YRS ?? '—' }}</b></span>
            <span>sex <b>{{ r.SEX || '—' }}</b></span>
            <span>state <b>{{ r.STATE || '—' }}</b></span>
            <span v-for="o in outcomes(r)" :key="o" class="oc">{{ o }}</span>
            <span v-if="r.DATEDIED" class="oc died">died {{ r.DATEDIED }}</span>
          </div>

          <table v-if="vaccinesFor(r.REPORT_ORDER).length" class="vtbl">
            <thead>
              <tr><th>TYPE</th><th>NAME</th><th>MANU</th><th>LOT</th><th>DOSE</th><th>ROUTE</th><th>SITE</th></tr>
            </thead>
            <tbody>
              <tr v-for="(v, i) in vaccinesFor(r.REPORT_ORDER)" :key="i">
                <td>{{ v.VAX_TYPE || '—' }}</td>
                <td>{{ v.VAX_NAME || '—' }}</td>
                <td>{{ v.VAX_MANU || '—' }}</td>
                <td>{{ v.VAX_LOT || '—' }}</td>
                <td>{{ v.VAX_DOSE_SERIES || '—' }}</td>
                <td>{{ v.VAX_ROUTE || '—' }}</td>
                <td>{{ v.VAX_SITE || '—' }}</td>
              </tr>
            </tbody>
          </table>

          <div v-if="symptomsFor(r.REPORT_ORDER).length" class="chips">
            <span v-for="s in symptomsFor(r.REPORT_ORDER)" :key="s" class="chip">{{ s }}</span>
          </div>

          <p class="rtext">{{ r.SYMPTOM_TEXT || '(no narrative)' }}</p>

          <div v-if="historyFields(r).length" class="history">
            <div v-for="h in historyFields(r)" :key="h.key" class="hfield">
              <span class="hlabel">{{ h.label }}</span> {{ h.value }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { fetchCase } from '../utils/api.js'

const props = defineProps({ vaersId: { type: String, required: true } })
defineEmits(['close'])

const caseData = ref(null)
const loading = ref(true)
const error = ref(null)

const reports = computed(() => caseData.value?.reports || [])

// vaccines/symptoms are per-report (matched by REPORT_ORDER); vaccines can be multiple rows.
function vaccinesFor(order) {
  return (caseData.value?.vaccines || []).filter((v) => (v.REPORT_ORDER ?? 1) === order)
}
function symptomsFor(order) {
  const entry = (caseData.value?.symptoms || []).find((s) => s.REPORT_ORDER === order)
  return entry?.symptoms || []
}

const HISTORY_FIELDS = [
  ['OTHER_MEDS', 'meds'], ['CUR_ILL', 'current illness'], ['HISTORY', 'history'],
  ['ALLERGIES', 'allergies'], ['LAB_DATA', 'lab data'],
]
function historyFields(r) {
  return HISTORY_FIELDS
    .filter(([key]) => r[key] != null && r[key] !== '')
    .map(([key, label]) => ({ key, label, value: r[key] }))
}

function outcomes(r) {
  const map = { DIED: 'DIED', L_THREAT: 'LIFE-THREAT', HOSPITAL: 'HOSPITAL', DISABLE: 'DISABLED',
    ER_VISIT: 'ER', ER_ED_VISIT: 'ER/ED' }
  const out = Object.entries(map).filter(([k]) => r[k] === 'Y').map(([, v]) => v)
  if (r.RECOVD === 'N') out.push('NOT RECOVERED')
  return out
}

onMounted(async () => {
  try {
    caseData.value = await fetchCase(props.vaersId)
  } catch (e) {
    error.value = e.message || 'failed to load case'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: min(820px, 92vw); max-height: 86vh; display: flex; flex-direction: column;
  background: #1b1d21; border: 1px solid #33b5e5; border-radius: 5px; box-shadow: 0 10px 40px rgba(0,0,0,.6); }
.mhead { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #2c2f36; }
.mid { font-weight: 700; color: #fff; font-size: 15px; }
.mcount { color: #8e8e8e; font-size: 12px; margin-left: 10px; }
.x { background: none; border: 0; color: #8e8e8e; font-size: 18px; cursor: pointer; }
.x:hover { color: #fff; }
.mbody { overflow-y: auto; padding: 8px 16px 16px; }
.state { padding: 30px; text-align: center; color: #8e8e8e; } .state.err { color: #e02f44; }
.report { border-bottom: 1px solid #23262b; padding: 12px 0; }
.report:last-child { border-bottom: 0; }
.rhead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: #3a4147; color: #d8d9da; }
.badge.primary { background: #33b5e5; color: #06131a; }
.rmeta { color: #8e8e8e; font-size: 12px; }
.rfields { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: #9aa0a6; margin-bottom: 6px; }
.rfields b { color: #d8d9da; font-weight: 600; }
.oc { background: #3b1f22; color: #e58a91; border-radius: 3px; padding: 0 6px; font-size: 11px; }
.oc.died { background: #2c2f36; color: #d8d9da; font-weight: 600; }
.rtext { font-size: 13px; color: #c7cbd1; line-height: 1.5; white-space: pre-wrap; }

.vtbl { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px; }
.vtbl th { text-align: left; color: #33b5e5; font-weight: 500; border-bottom: 1px solid #2c2f36; padding: 3px 6px; }
.vtbl td { padding: 3px 6px; border-bottom: 1px solid #1e2024; color: #c7cbd1; }

.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.chip { background: #23262b; color: #b8bcc2; border-radius: 10px; padding: 2px 9px; font-size: 11px; }

.history { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
.hfield { font-size: 12px; color: #c7cbd1; }
.hlabel { color: #8e8e8e; font-weight: 600; text-transform: uppercase; font-size: 10px; margin-right: 4px; }
</style>
