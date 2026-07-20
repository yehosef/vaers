<template>
  <div class="panel" :class="`c${span}`">
    <div class="ptitle phead">
      <span>{{ detail ? 'Age (<20)' : 'Age' }}</span>
      <button class="pill" :class="{ on: detail }" @click="detail = !detail"
              title="toggle single-year &lt;20 detail">&lt;20</button>
    </div>
    <div ref="el" class="pbody">
      <div class="muted small ctr pload">loading…</div>
    </div>
  </div>
</template>

<script setup>
// Age panel with the <20 single-year toggle. The toggle is view-local display
// state (both series are always fetched); bar clicks add AGE_YRS range filters
// straight to the store.
import { ref } from 'vue'
import { useFilterStore } from '../stores/filterStore.js'
import { usePlot } from '../utils/usePlot.js'
import * as plots from '../utils/plots.js'

const props = defineProps({
  span: { type: [Number, String], default: 4 },
  data: { type: Array, default: null },      // fixed 8-bucket series (age)
  dataU20: { type: Array, default: null },   // single-year 0-19 series (age_u20)
  height: { type: Number, default: 210 },
})

const store = useFilterStore()
const detail = ref(false)

// Fixed 8 age buckets from the API → half-open [lo, hi) ranges; '60+' is a single-sided filter.
const AGE_BUCKET_RANGES = {
  '0-1': [0, 1], '1-2': [1, 2], '2-4': [2, 4], '4-10': [4, 10],
  '10-20': [10, 20], '20-40': [20, 40], '40-60': [40, 60],
}
function onBucketClick(d) {
  if (d.label === '60+') { store.addFilters([{ field: 'AGE_YRS', op: '>=', value: 60 }]); return }
  const range = AGE_BUCKET_RANGES[d.label]
  if (!range) return
  store.addFilters([
    { field: 'AGE_YRS', op: '>=', value: range[0] },
    { field: 'AGE_YRS', op: '<', value: range[1] },
  ])
}
function onU20Click(d) {
  store.addFilters([
    { field: 'AGE_YRS', op: '>=', value: d.age },
    { field: 'AGE_YRS', op: '<', value: d.age + 1 },
  ])
}

const el = ref(null)
usePlot(el, (w) => {
  if (detail.value) return props.dataU20 ? plots.ageU20(props.dataU20, w, props.height, onU20Click) : null
  return props.data ? plots.ageBuckets(props.data, w, props.height, onBucketClick) : null
}, [() => props.data, () => props.dataU20, detail])
</script>
