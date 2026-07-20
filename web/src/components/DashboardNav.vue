<template>
  <nav class="dnav">
    <RouterLink v-for="v in views" :key="v.to" :to="v.to"
                :class="{ on: $route.path === v.to }">{{ v.label }}</RouterLink>
    <span class="about" :title="aboutText">ⓘ about the date axes</span>
  </nav>
</template>

<script setup>
// Nav tabs — the reboot's replacement for Grafana's dashlist panel. The about
// tooltip carries the old VizVax Home page's date-axis explainer.
import { RouterLink } from 'vue-router'

const views = [
  { to: '/', label: 'Overview' },
  { to: '/people', label: 'People' },
  { to: '/vaccine', label: 'Vaccine' },
  { to: '/all', label: 'All Reports' },
  { to: '/data-quality', label: 'Data Quality' },
]

const aboutText =
  'Overview, People, Vaccine and Data Quality plot events by VAX_DATE — the vaccination date. ' +
  'About 11.5% of reports have no VAX_DATE and never appear on those charts. ' +
  'All Reports plots by RECVDATE — the date VAERS received the report — so every report is ' +
  'visible there, and its toggle can isolate the reports missing a VAX_DATE.'
</script>
