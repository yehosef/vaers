<template>
  <div>
    <div class="view-note">
      <button class="pill" :class="{ on: store.activeView.noVaxDateOnly }"
              @click="store.setNoVaxDateOnly(!store.activeView.noVaxDateOnly)">No VAX_DATE only</button>
      <span>
        Every report, plotted by <b>RECVDATE</b> (when VAERS received it) — including the
        ~11.5% with no vaccination date, which the VAX_DATE views can never show.
      </span>
    </div>
    <div class="grid">
      <BarPanel title="REPORTS RECEIVED" :span="6" :data="dash.events_by_recvdate"
                :builder="plots.eventsByYear" :height="230" />
      <StatPanel :value="dash.total" />
      <AgePanel :span="4" :data="dash.age" :data-u20="dash.age_u20" />
    </div>
    <div class="grid">
      <TermsTablePanel title="Vax Types" header="VAX.TYPE" :span="3" :rows="dash.vax_types"
                       label-key="vax_type" :limit="10" />
      <BarPanel title="Num Vacc." :span="3" :data="dash.num_vax" :builder="plots.numVax" />
      <PiePanel title="Reactions" :span="2" :data="dash.reactions" label-key="reaction" @select="onReaction" />
      <TermsTablePanel title="Has data" header="HISTORY FIELD" :span="4" :rows="dash.has_data"
                       clickable @select="onHasData" />
    </div>
  </div>
</template>

<script setup>
// All Reports — the old "VAERS All" + "VAERS No VAX_DATE" dashboards, merged:
// the RECVDATE axis shows every report, and the toggle reproduces the No
// VAX_DATE dashboard (which was the All dashboard + !_exists_:VAX_DATE on every
// query). No onset panel — NUMDAYS is undefined without VAX_DATE, and the
// originals faithfully omitted it too.
import { computed, onMounted } from 'vue'
import { useFilterStore } from '../stores/filterStore.js'
import BarPanel from '../components/BarPanel.vue'
import StatPanel from '../components/StatPanel.vue'
import PiePanel from '../components/PiePanel.vue'
import TermsTablePanel from '../components/TermsTablePanel.vue'
import AgePanel from '../components/AgePanel.vue'
import * as plots from '../utils/plots.js'

const store = useFilterStore()
const dash = computed(() => store.dashboard || {})

const PANELS = ['total', 'events_by_recvdate', 'vax_types', 'reactions', 'has_data',
  'age', 'age_u20', 'num_vax']
onMounted(() => store.setActiveView({ name: 'all', panels: PANELS, dateField: 'RECVDATE' }))

const onReaction = (d) => store.addFilters([{ field: 'REACTIONS', op: '=', value: d.reaction }])
const onHasData = (field) => store.addFilters([{ field: 'HAS_DATA', op: '=', value: field }])
</script>
