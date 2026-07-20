<template>
  <div>
    <div class="grid">
      <BarPanel title="VAERS EVENTS" :span="6" :data="dash.events_by_year" :builder="plots.eventsByYear" :height="230" />
      <StatPanel :value="dash.total" :spark="dash.sparkline" />
      <BarPanel title="Onset day" :span="4" :data="dash.onset_days" :builder="plots.onsetDays" />
    </div>
    <div class="grid">
      <TermsTablePanel title="Vax Types" header="VAX.TYPE" :span="3" :rows="dash.vax_types"
                       label-key="vax_type" :limit="10" />
      <BarPanel title="Num Vacc." :span="3" :data="dash.num_vax" :builder="plots.numVax" />
      <PiePanel title="Reactions" :span="2" :data="dash.reactions" label-key="reaction" @select="onReaction" />
      <AgePanel :span="4" :data="dash.age" :data-u20="dash.age_u20" />
    </div>
    <div class="grid">
      <SymptomsPanel :span="12" :symptoms="dash.symptoms" :height="300" @select="onSymptom" />
    </div>
  </div>
</template>

<script setup>
// Overview — the old "VAERS General" dashboard (VAX_DATE axis).
import { computed, onMounted } from 'vue'
import { useFilterStore } from '../stores/filterStore.js'
import BarPanel from '../components/BarPanel.vue'
import StatPanel from '../components/StatPanel.vue'
import PiePanel from '../components/PiePanel.vue'
import TermsTablePanel from '../components/TermsTablePanel.vue'
import SymptomsPanel from '../components/SymptomsPanel.vue'
import AgePanel from '../components/AgePanel.vue'
import * as plots from '../utils/plots.js'

const store = useFilterStore()
const dash = computed(() => store.dashboard || {})

const PANELS = ['total', 'events_by_year', 'sparkline', 'onset_days', 'vax_types',
  'num_vax', 'age', 'age_u20', 'reactions', 'symptoms']
onMounted(() => store.setActiveView({ name: 'overview', panels: PANELS }))

const onReaction = (d) => store.addFilters([{ field: 'REACTIONS', op: '=', value: d.reaction }])
const onSymptom = (d) => store.addFilters([{ field: 'SYMPTOMS', op: '=', value: d.symptom }])
</script>
