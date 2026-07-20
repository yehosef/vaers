<template>
  <div class="panel stat" :class="`c${span}`">
    <div class="ptitle">{{ title }}</div>
    <div class="stat-value">{{ display }}</div>
    <div v-if="sub" class="stat-sub">{{ sub }}</div>
    <div v-if="spark" ref="sparkEl" class="spark"></div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { usePlot } from '../utils/usePlot.js'
import * as plots from '../utils/plots.js'

const props = defineProps({
  title: { type: String, default: 'Total' },
  value: { type: [Number, String], default: null },  // null => not fetched yet
  sub: String,                                        // small line under the value
  spark: { type: Array, default: null },              // sparkline series (optional)
  span: { type: [Number, String], default: 2 },
})

const display = computed(() => {
  if (props.value == null) return '…'
  if (typeof props.value === 'string') return props.value
  return props.value >= 1e5 ? plots.fmt(props.value) : props.value.toLocaleString()
})

const sparkEl = ref(null)
usePlot(sparkEl, () => (props.spark ? plots.sparkline(props.spark) : null), () => props.spark)
</script>
