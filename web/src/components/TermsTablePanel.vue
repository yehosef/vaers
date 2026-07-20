<template>
  <div class="panel" :class="`c${span}`">
    <div class="ptitle" :title="tooltip">{{ title }} <span v-if="note" class="muted small">· {{ note }}</span></div>
    <table class="tbl">
      <thead><tr><th>{{ header }}</th><th class="num">Total</th></tr></thead>
      <tbody>
        <tr v-if="!rows"><td colspan="2" class="muted center">loading…</td></tr>
        <tr v-else-if="!shown.length"><td colspan="2" class="muted center">—</td></tr>
        <tr v-for="row in shown" :key="row[labelKey]" :class="{ crow: clickable }"
            @click="clickable && $emit('select', row[labelKey])">
          <td>{{ row[labelKey] }}</td><td class="num">{{ fmt(row.count) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
// One ranked-terms table for Vax Types / Manufacturers / State / Route / Site /
// Admin-by / Funded-by / HAS_DATA / Combos — parameterized over the label key.
import { computed } from 'vue'
import { fmt } from '../utils/plots.js'

const props = defineProps({
  title: { type: String, required: true },
  header: { type: String, required: true },
  note: String,
  tooltip: String,
  span: { type: [Number, String], default: 3 },
  rows: { type: Array, default: null },   // null => not fetched yet
  labelKey: { type: String, default: 'label' },
  clickable: { type: Boolean, default: false },
  limit: { type: Number, default: 0 },    // 0 => show all returned rows
})
defineEmits(['select'])

const shown = computed(() => (props.limit > 0 ? (props.rows || []).slice(0, props.limit) : props.rows || []))
</script>
