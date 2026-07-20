<template>
  <div class="panel" :class="`c${span}`">
    <div class="ptitle" :title="tooltip">{{ title }} <span v-if="note" class="muted small">· {{ note }}</span></div>
    <div ref="el" class="pbody">
      <div class="muted small ctr pload">loading…</div>
    </div>
    <slot name="footer" />
  </div>
</template>

<script setup>
// Generic chart panel: `builder` is any plots.js builder with the
// (data, width, height, onClick?) signature; extra args are ignored by
// builders that don't take a click handler.
import { ref } from 'vue'
import { usePlot } from '../utils/usePlot.js'

const props = defineProps({
  title: { type: String, required: true },
  note: String,                 // muted suffix after the title
  tooltip: String,
  span: { type: [Number, String], default: 4 },
  data: { type: Array, default: null },   // null => not fetched yet
  builder: { type: Function, required: true },
  height: { type: Number, default: 210 },
  onBarClick: Function,
})

const el = ref(null)
usePlot(el, (w) => (props.data ? props.builder(props.data, w, props.height, props.onBarClick) : null),
  () => props.data)
</script>
