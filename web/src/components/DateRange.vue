<template>
  <div class="dr" ref="root">
    <label class="lbl">TIME RANGE</label>
    <button class="box" :class="{ open }" @click="toggle">
      <span class="ico">🗓</span>
      <span class="txt">{{ label }}</span>
      <span class="caret">▾</span>
    </button>

    <div v-if="open" class="menu" @click.stop>
      <div class="presets">
        <div class="ph">Quick ranges</div>
        <button v-for="p in presets" :key="p.label" class="preset" @click="apply(p.from, p.to)">{{ p.label }}</button>
      </div>
      <div class="abs">
        <div class="ph">Absolute range</div>
        <label class="fld">From<input type="date" v-model="from" :min="MIN" :max="MAX" /></label>
        <label class="fld">To<input type="date" v-model="to" :min="MIN" :max="MAX" /></label>
        <div class="actions">
          <button class="btn primary" @click="apply(from, to)">Apply</button>
          <button class="btn" @click="apply('', '')">Clear</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  from: { type: String, default: '' },
  to: { type: String, default: '' },
})
const emit = defineEmits(['change'])

const MIN = '1990-01-01'
const MAX = '2027-12-31'
const root = ref(null)
const open = ref(false)
const from = ref(props.from)
const to = ref(props.to)
watch(() => [props.from, props.to], ([f, t]) => { from.value = f; to.value = t })

const label = computed(() => {
  if (!props.from && !props.to) return 'All time'
  return `${props.from || '…'} → ${props.to || 'now'}`
})

// Days-only quick ranges. Dates are computed once at mount to keep them stable.
const today = new Date()
const iso = (d) => d.toISOString().slice(0, 10)
const yearsAgo = (n) => { const d = new Date(today); d.setFullYear(d.getFullYear() - n); return iso(d) }
const presets = [
  { label: 'All time', from: '', to: '' },
  { label: 'Last 12 months', from: yearsAgo(1), to: iso(today) },
  { label: 'Last 5 years', from: yearsAgo(5), to: iso(today) },
  { label: 'Since 2020', from: '2020-01-01', to: iso(today) },
  { label: '2010 – 2019', from: '2010-01-01', to: '2019-12-31' },
]

function toggle() { open.value = !open.value }
function apply(f, t) { open.value = false; emit('change', f, t) }
function onDoc(e) { if (open.value && root.value && !root.value.contains(e.target)) open.value = false }
onMounted(() => document.addEventListener('mousedown', onDoc))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc))
</script>

<style scoped>
.dr { display: flex; align-items: center; gap: 8px; position: relative; }
.lbl { color: #33b5e5; font-size: 12px; font-weight: 600; white-space: nowrap; }
.box {
  display: flex; align-items: center; gap: 7px;
  background: #0b0c0e; border: 1px solid #2c2f36; border-radius: 3px; padding: 6px 9px;
  color: #d8d9da; font-size: 13px; cursor: pointer;
}
.box.open { border-color: #33b5e5; box-shadow: 0 0 0 1px #33b5e5; }
.ico { font-size: 12px; } .caret { color: #8e8e8e; font-size: 10px; }
.menu {
  position: absolute; top: 100%; right: 0; z-index: 50; margin-top: 4px; display: flex;
  background: #1f2126; border: 1px solid #33b5e5; border-radius: 3px; box-shadow: 0 6px 20px rgba(0,0,0,.5);
}
.presets { border-right: 1px solid #2c2f36; padding: 8px; display: flex; flex-direction: column; gap: 2px; min-width: 130px; }
.ph { color: #8e8e8e; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }
.preset { text-align: left; background: none; border: 0; color: #d8d9da; font-size: 13px; padding: 6px 8px; border-radius: 3px; cursor: pointer; }
.preset:hover { background: #2c3235; }
.abs { padding: 10px; display: flex; flex-direction: column; gap: 8px; min-width: 190px; }
.fld { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: #8e8e8e; }
.fld input { background: #0b0c0e; border: 1px solid #2c2f36; border-radius: 3px; color: #d8d9da; padding: 6px; font-size: 13px; color-scheme: dark; }
.actions { display: flex; gap: 6px; margin-top: 2px; }
.btn { flex: 1; background: #2c3235; border: 1px solid #3a4147; color: #d8d9da; border-radius: 3px; padding: 6px; cursor: pointer; font-size: 13px; }
.btn.primary { background: #33b5e5; border-color: #33b5e5; color: #06131a; font-weight: 600; }
.btn:hover { filter: brightness(1.1); }
</style>
