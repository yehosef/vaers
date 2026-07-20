<template>
  <div class="dash">
    <DashboardNav />
    <FilterBar />
    <AdhocRows />
    <div class="content">
      <RouterView />
      <CasesTablePanel v-if="store.dashboard" />
      <div v-if="!store.dashboard" class="booting">Loading dashboard…</div>
      <div v-if="store.loading && store.dashboard" class="load-overlay">
        <div class="spinner"></div><span>Loading…</span>
      </div>
    </div>
  </div>
</template>

<script setup>
// Persistent shell around the five views: filter bar, adhoc rows, nav tabs and
// the shared cases table stay mounted — only the panel grid (RouterView) swaps,
// so the filter context carries across navigation like Grafana variables did.
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useFilterStore } from '../stores/filterStore.js'
import DashboardNav from './DashboardNav.vue'
import FilterBar from './FilterBar.vue'
import AdhocRows from './AdhocRows.vue'
import CasesTablePanel from './CasesTablePanel.vue'

const store = useFilterStore()
onMounted(() => store.init())
</script>
