<template>
  <div>
    <!-- A VAX_DATE range excludes VAX_DATE-less reports by definition (NULL fails any
         comparison), which zeroes the two "No VAX_DATE" panels — say so instead of
         letting the page about missingness silently report 0%. -->
    <div v-if="store.dateFrom || store.dateTo" class="view-note">
      ⚠ A date range is active and binds to <b>VAX_DATE</b> on this view — reports lacking a
      VAX_DATE are excluded by definition, so the "No VAX_DATE" panels read zero. Clear the
      range, or use All Reports (RECVDATE axis) to date-restrict them.
    </div>
    <div class="grid">
      <StatPanel title="No VAX_DATE" :value="pctDisplay" :sub="pctSub" />
      <BarPanel title="Reports without VAX_DATE" note="by RECVDATE year" :span="5"
                :data="dash.no_vaxdate_by_recvdate" :builder="plots.eventsByYear" :height="230"
                tooltip="When the reports lacking a vaccination date arrived. These reports are invisible on every VAX_DATE chart." />
      <BarPanel title="Report lag" :span="5" :data="dash.lag" :builder="plots.lagBins" :height="230"
                tooltip="Days between vaccination (VAX_DATE) and VAERS receiving the report (RECVDATE)." />
    </div>
    <div class="grid">
      <BarPanel title="Deaths" note="by DATEDIED year" :span="6"
                :data="dash.deaths?.rows" :builder="plots.deathsByYear"
                tooltip="Deaths by DATEDIED year; deaths lacking a death date are excluded; the date-range filter still selects which cases appear.">
        <template #footer>
          <div v-if="dash.deaths && dash.deaths.missing_date" class="muted small ctr">
            {{ dash.deaths.missing_date.toLocaleString() }} deaths lack a death date (excluded)
          </div>
        </template>
      </BarPanel>
      <BarPanel title="Deaths" note="by VAX_DATE year" :span="6"
                :data="dash.died_series" :builder="plots.deathsByYear"
                tooltip="Reports with DIED='Y' by vaccination year — compare against the DATEDIED series to spot date-field gaps." />
    </div>
    <div class="grid">
      <BarPanel title="Follow-up reports per case" :span="4" :data="dash.followup_dist" :builder="plots.lagBins"
                tooltip="How many secondary (follow-up) submissions each case has. Follow-ups exist since May 2025 and are collapsed into their case everywhere else." />
      <TermsTablePanel title="Has data" header="HISTORY FIELD" :span="4" :rows="dash.has_data"
                       tooltip="How many filtered cases carry each history field after null-like cleaning ('none', 'n/a', … count as absent)."
                       clickable @select="onHasData" />
      <TermsTablePanel title="Vax Lot" header="VAX_LOT" note="raw / uncleaned" :span="4" :rows="dash.vax_lot"
                       tooltip="Lot numbers exactly as reported — 269k+ distinct spellings, ~29% missing; only the obvious junk spellings ('UNK', 'unknown', 'no batch number') are excluded. Treat with caution." />
    </div>
  </div>
</template>

<script setup>
// Data Quality — new view (no 2019 counterpart): where the reporting artifacts
// live. Report lag and the deaths-by-DATEDIED panel move here from the old
// hidden "more" row; the rest surfaces missingness (VAX_DATE, death dates, lot
// numbers) and the follow-up structure. VAX_DATE axis for the range filter.
import { computed, onMounted } from 'vue'
import { useFilterStore } from '../stores/filterStore.js'
import BarPanel from '../components/BarPanel.vue'
import StatPanel from '../components/StatPanel.vue'
import TermsTablePanel from '../components/TermsTablePanel.vue'
import * as plots from '../utils/plots.js'

const store = useFilterStore()
const dash = computed(() => store.dashboard || {})

const PANELS = ['no_vaxdate_pct', 'no_vaxdate_by_recvdate', 'lag', 'deaths', 'died_series',
  'followup_dist', 'has_data', 'vax_lot']
onMounted(() => store.setActiveView({ name: 'data-quality', panels: PANELS }))

const pctDisplay = computed(() => {
  const p = dash.value.no_vaxdate_pct
  return p ? `${p.pct.toFixed(1)}%` : null
})
const pctSub = computed(() => {
  const p = dash.value.no_vaxdate_pct
  return p ? `${p.missing.toLocaleString()} of ${p.total.toLocaleString()} reports` : ''
})

const onHasData = (field) => store.addFilters([{ field: 'HAS_DATA', op: '=', value: field }])
</script>
