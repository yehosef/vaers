<template>
  <div class="panel" :class="`c${span}`">
    <div class="ptitle">{{ title }}</div>
    <div class="pie-wrap">
      <div ref="el"></div>
      <ul class="legend">
        <li v-for="(d, i) in data || []" :key="d[labelKey]" class="clickable" @click="$emit('select', d)">
          <span class="dot" :style="{ background: palette[i % palette.length] }"></span>{{ d[labelKey] }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
// Accessor-parameterized pie (reactions/sex) — legend + slices both emit select(datum).
import { ref } from 'vue'
import { usePlot } from '../utils/usePlot.js'
import * as plots from '../utils/plots.js'

const props = defineProps({
  title: { type: String, required: true },
  span: { type: [Number, String], default: 2 },
  data: { type: Array, default: null },
  labelKey: { type: String, required: true },
})
const emit = defineEmits(['select'])
const palette = plots.PALETTE

const el = ref(null)
usePlot(el, () => (props.data
  ? plots.pie(props.data, {
      getLabel: (d) => d[props.labelKey],
      getCount: (d) => d.count,
      onClick: (d) => emit('select', d),
    })
  : null), () => props.data)
</script>
