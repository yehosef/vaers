<template>
  <div class="panel" :class="`c${span}`">
    <div class="ptitle">Symptoms <span class="muted small">· {{ caption }}</span></div>
    <div ref="el" class="pbody">
      <div class="muted small ctr pload">loading…</div>
    </div>
  </div>
</template>

<script setup>
// Dual-mode symptoms panel: 'top' (background counts) when unfiltered, JLH
// significant-terms once any filter is active. Bars emit select(datum).
import { ref, computed } from 'vue'
import { usePlot } from '../utils/usePlot.js'
import * as plots from '../utils/plots.js'

const props = defineProps({
  symptoms: { type: Object, default: null },   // { mode, rows } from the API
  span: { type: [Number, String], default: 4 },
  height: { type: Number, default: 300 },
})
const emit = defineEmits(['select'])

const caption = computed(() =>
  props.symptoms?.mode === 'significant' ? 'significant vs background' : 'top symptoms')

const el = ref(null)
usePlot(el, (w) => (props.symptoms
  ? plots.symptomsBar(props.symptoms.rows || [], props.symptoms.mode || 'top', w, props.height,
      (d) => emit('select', d))
  : null), () => props.symptoms)
</script>
