<template>
  <div>
    <div class="grid">
      <BarPanel title="VAERS EVENTS" :span="6" :data="dash.events_by_year" :builder="plots.eventsByYear" :height="230" />
      <StatPanel :value="dash.total" />
      <BarPanel title="Num Vacc." :span="4" :data="dash.num_vax" :builder="plots.numVax" />
    </div>
    <div class="grid">
      <TermsTablePanel title="Vax Types" header="VAX.TYPE" :span="3" :rows="dash.vax_types" label-key="vax_type" />
      <TermsTablePanel title="Manufacturers" header="MANUFACTURER" :span="3" :rows="dash.manufacturers"
                       label-key="manu" clickable @select="onManu" />
      <TermsTablePanel title="Administered by" header="V_ADMINBY" :span="3" :rows="dash.v_adminby"
                       clickable @select="onAdminBy" />
      <TermsTablePanel title="Funded by" header="V_FUNDBY" :span="3" :rows="dash.v_fundby"
                       clickable @select="onFundBy" />
    </div>
    <!-- second-phase panels: vaersvax raw-join aggregates, fetched after first paint -->
    <div class="grid">
      <TermsTablePanel title="Route" header="VAX_ROUTE" :span="3" :rows="dash.vax_route" />
      <TermsTablePanel title="Site" header="VAX_SITE" :span="3" :rows="dash.vax_site" />
      <TermsTablePanel title="Dose series" header="DOSE" :span="3" :rows="dash.vax_dose_series" />
      <TermsTablePanel title="Vax combinations" header="COMBO" :span="3" :rows="dash.vax_combos"
                       tooltip="The full set of vaccine types on the report, as one combination (sorted, '::'-separated). Single-vaccine reports show the bare type." />
    </div>
  </div>
</template>

<script setup>
// Vaccine — the old "VAERS Vaccine" dashboard: product-focused breakdowns
// (VAX_DATE axis). The vaersvax raw-join panels load in a second fetch so the
// cheap panels paint first (they run 2-3× slower under the 550MB budget).
import { computed, onMounted } from 'vue'
import { useFilterStore } from '../stores/filterStore.js'
import BarPanel from '../components/BarPanel.vue'
import StatPanel from '../components/StatPanel.vue'
import TermsTablePanel from '../components/TermsTablePanel.vue'
import * as plots from '../utils/plots.js'

const store = useFilterStore()
const dash = computed(() => store.dashboard || {})

const PANELS = ['total', 'events_by_year', 'num_vax', 'vax_types', 'manufacturers', 'v_adminby', 'v_fundby']
const LAZY_PANELS = ['vax_route', 'vax_site', 'vax_dose_series', 'vax_combos']
onMounted(() => store.setActiveView({ name: 'vaccine', panels: PANELS, lazyPanels: LAZY_PANELS }))

const onManu = (manu) => store.addFilters([{ field: 'VAX_MANU', op: '=', value: manu }])
const onAdminBy = (v) => store.addFilters([{ field: 'V_ADMINBY', op: '=', value: v }])
const onFundBy = (v) => store.addFilters([{ field: 'V_FUNDBY', op: '=', value: v }])
</script>
