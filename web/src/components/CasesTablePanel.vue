<template>
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
          <tr v-for="row in store.cases.rows" :key="row.VAERS_ID" class="crow" @click="openId = row.VAERS_ID">
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

  <CaseModal v-if="openId" :vaers-id="openId" @close="openId = null" />
</template>

<script setup>
// Shared sortable/paginated case table + case modal — rendered once in the
// layout, below whichever view's panel grid is active.
import { ref } from 'vue'
import { useFilterStore } from '../stores/filterStore.js'
import CaseModal from './CaseModal.vue'

const store = useFilterStore()
const openId = ref(null)

function sortArrow(field) {
  if (store.sort.field !== field) return ''
  return store.sort.dir === 'asc' ? '▲' : '▼'
}

// #VAX cell: green(1-2) → amber → orange → red, matching Grafana thresholds.
function vaxCellStyle(n) {
  const bg = n >= 6 ? '#890f02' : n >= 5 ? '#bf1b00' : n >= 4 ? '#ef843c'
    : n >= 3 ? '#e0b400' : ''
  return bg ? { background: bg, color: '#fff' } : {}
}
</script>
