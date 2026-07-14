<template>
  <div class="vts" ref="root">
    <label class="lbl">VAX TYPE</label>
    <div class="box" :class="{ open }" @click="toggle">
      <input
        ref="search"
        class="box-input"
        :placeholder="summary"
        v-model="filter"
        @click.stop="openDropdown"
        @keydown.esc="close"
      />
      <span class="caret">▾</span>
    </div>

    <div v-if="open" class="menu" @click.stop>
      <div class="row header" @click="showSelectedOnly = !showSelectedOnly">
        <span class="chk" :class="{ on: showSelectedOnly }"></span>
        Selected ({{ draft.length }})
      </div>
      <div v-if="!filter" class="row" @click="toggleAll">
        <span class="chk" :class="{ check: draft.length === 0 }"></span>
        All
      </div>
      <div class="list">
        <div v-for="t in visibleOptions" :key="t" class="row" @click="toggleOne(t)">
          <span class="chk" :class="{ on: draft.includes(t) }"></span>
          {{ t }}
        </div>
        <div v-if="!visibleOptions.length" class="row empty">no match</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  options: { type: Array, default: () => [] },   // available vax types
  modelValue: { type: Array, default: () => [] }, // selected
})
const emit = defineEmits(['update:modelValue', 'change'])

const root = ref(null)
const search = ref(null)
const open = ref(false)
const filter = ref('')
const showSelectedOnly = ref(false)
const draft = ref([...props.modelValue])

watch(() => props.modelValue, (v) => { draft.value = [...v] })

// Grafana lists vax types alphabetically.
const sorted = computed(() => [...props.options].sort((a, b) => a.localeCompare(b)))
const visibleOptions = computed(() => {
  let list = sorted.value
  if (showSelectedOnly.value) list = list.filter((t) => draft.value.includes(t))
  const q = filter.value.trim().toUpperCase()
  if (q) list = list.filter((t) => t.toUpperCase().includes(q))
  return list
})

const summary = computed(() => {
  if (!draft.value.length) return 'All'
  if (draft.value.length === 1) return draft.value[0]
  return `${draft.value.length} selected`
})

function toggle() { open.value ? close() : openDropdown() }
function openDropdown() {
  open.value = true
  requestAnimationFrame(() => search.value?.focus())
}
function toggleAll() { draft.value = [] }               // All === empty selection
function toggleOne(t) {
  const i = draft.value.indexOf(t)
  if (i >= 0) draft.value.splice(i, 1)
  else draft.value.push(t)
}
function close() {
  open.value = false
  filter.value = ''
  showSelectedOnly.value = false
  // apply on close if selection changed
  const changed = draft.value.length !== props.modelValue.length ||
    draft.value.some((t) => !props.modelValue.includes(t))
  if (changed) { emit('update:modelValue', [...draft.value]); emit('change', [...draft.value]) }
}

function onDocClick(e) { if (open.value && root.value && !root.value.contains(e.target)) close() }
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
</script>

<style scoped>
.vts { display: flex; align-items: center; gap: 8px; position: relative; }
.lbl { color: #33b5e5; font-size: 12px; font-weight: 600; white-space: nowrap; }
.box {
  display: flex; align-items: center; gap: 4px; min-width: 150px;
  background: #0b0c0e; border: 1px solid #2c2f36; border-radius: 3px; padding: 2px 6px; cursor: text;
}
.box.open { border-color: #33b5e5; box-shadow: 0 0 0 1px #33b5e5; }
.box-input { flex: 1; background: transparent; border: 0; color: #d8d9da; font-size: 13px; padding: 4px 0; outline: none; min-width: 0; }
.box-input::placeholder { color: #d8d9da; }
.caret { color: #8e8e8e; font-size: 10px; }
.menu {
  position: absolute; top: 100%; left: 66px; z-index: 50; margin-top: 4px;
  width: 230px; max-height: 340px; display: flex; flex-direction: column;
  background: #1f2126; border: 1px solid #33b5e5; border-radius: 3px;
  box-shadow: 0 6px 20px rgba(0,0,0,.5);
}
.list { overflow-y: auto; }
.row {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px; font-size: 13px;
  color: #d8d9da; cursor: pointer; white-space: nowrap;
}
.row:hover { background: #2c3235; }
.row.header { color: #8e8e8e; border-bottom: 1px solid #2c2f36; }
.row.empty { color: #6b7078; cursor: default; }
.row.empty:hover { background: none; }
.chk {
  width: 15px; height: 15px; border: 1px solid #56606b; border-radius: 2px;
  display: inline-block; flex: 0 0 auto; position: relative; background: #0b0c0e;
}
.chk.on { background: #33b5e5; border-color: #33b5e5; }
.chk.on::after, .chk.check::after {
  content: '✓'; position: absolute; top: -3px; left: 1px; font-size: 13px; color: #fff;
}
.chk.check::after { color: #33b5e5; }
.chk.check { border-color: transparent; background: transparent; }
</style>
