<template>
  <div>
    <div class="grid">
      <BarPanel title="VAERS EVENTS" :span="6" :data="dash.events_by_year" :builder="plots.eventsByYear" :height="230" />
      <StatPanel :value="dash.total" />
      <AgePanel :span="4" :data="dash.age" :data-u20="dash.age_u20" />
    </div>
    <div class="grid">
      <SymptomsPanel :span="6" :symptoms="dash.symptoms" :height="280" @select="onSymptom" />
      <PiePanel title="Reactions" :span="3" :data="dash.reactions" label-key="reaction" @select="onReaction" />
      <PiePanel title="Sex" :span="3" :data="dash.sex" label-key="sex" @select="onSex" />
    </div>
    <div class="grid">
      <TermsTablePanel title="State" header="STATE" :span="4" :rows="dash.states"
                       label-key="state" clickable @select="onState" />
      <TermsTablePanel title="Has data" header="HISTORY FIELD" :span="4" :rows="dash.has_data"
                       tooltip="How many filtered cases carry each history field (meds / current illness / history / allergies / lab data) after null-like cleaning."
                       clickable @select="onHasData" />
      <TermsTablePanel title="Vax Types" header="VAX.TYPE" :span="4" :rows="dash.vax_types"
                       label-key="vax_type" :limit="10" />
    </div>
  </div>
</template>

<script setup>
// People — the old "VAERS People" dashboard: demographics + coded symptoms
// (the JLH significant-terms panel is the upgrade of the original's top-50
// symptom table). VAX_DATE axis.
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

const PANELS = ['total', 'events_by_year', 'age', 'age_u20', 'vax_types', 'symptoms',
  'reactions', 'states', 'sex', 'has_data']
onMounted(() => store.setActiveView({ name: 'people', panels: PANELS }))

const onReaction = (d) => store.addFilters([{ field: 'REACTIONS', op: '=', value: d.reaction }])
const onSymptom = (d) => store.addFilters([{ field: 'SYMPTOMS', op: '=', value: d.symptom }])
const onSex = (d) => store.addFilters([{ field: 'SEX', op: '=', value: d.sex }])
const onState = (state) => store.addFilters([{ field: 'STATE', op: '=', value: state }])
const onHasData = (field) => store.addFilters([{ field: 'HAS_DATA', op: '=', value: field }])
</script>
