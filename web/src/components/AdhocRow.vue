<template>
  <div class="arow">
    <select class="inp field" v-model="row.field" @change="onFieldChange">
      <option v-for="f in fields" :key="f" :value="f">{{ f }}</option>
    </select>

    <select class="inp op" v-model="row.op">
      <option v-for="o in ops" :key="o" :value="o">{{ o }}</option>
    </select>

    <!-- value input adapts to the field's kind (Grafana-style) -->
    <span v-if="loading" class="hint">…</span>
    <select v-else-if="meta && meta.kind === 'enum'" class="inp val" v-model="row.value" @change="$emit('apply')">
      <option value="" disabled>value…</option>
      <option v-for="v in meta.values" :key="v" :value="v">{{ v }}</option>
    </select>
    <select v-else-if="meta && meta.kind === 'numeric' && meta.values" class="inp val" v-model="row.value" @change="$emit('apply')">
      <option value="" disabled>value…</option>
      <option v-for="v in meta.values" :key="v" :value="v">{{ v }}</option>
    </select>
    <input v-else-if="meta && meta.kind === 'numeric'" class="inp val" type="number"
           v-model="row.value" :placeholder="rangeHint" @keyup.enter="$emit('apply')" @change="$emit('apply')" />
    <template v-else-if="meta && meta.kind === 'text' && meta.suggestions && meta.suggestions.length">
      <input class="inp val" type="text" v-model="row.value" :list="listId" placeholder="value"
             @keyup.enter="$emit('apply')" @change="$emit('apply')" />
      <datalist :id="listId">
        <option v-for="s in meta.suggestions" :key="s" :value="s"></option>
      </datalist>
    </template>
    <input v-else class="inp val" type="text" v-model="row.value" placeholder="value"
           @keyup.enter="$emit('apply')" />

    <button class="rm" @click="$emit('remove')" title="remove">✕</button>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { fetchFieldValues } from '../utils/api.js'

const props = defineProps({
  row: { type: Object, required: true },       // { field, op, value } from the store (reactive)
  fields: { type: Array, default: () => [] },
})
const emit = defineEmits(['apply', 'remove'])

const meta = ref(null)
const loading = ref(false)
// Unique per row instance so multiple text-with-suggestions rows don't collide on one <datalist> id.
const listId = `adhoc-suggest-${Math.random().toString(36).slice(2)}`

const NUM_OPS = ['=', '!=', '>', '<', '>=', '<=']
const ENUM_OPS = ['=', '!=']
const ops = computed(() => (meta.value?.kind === 'numeric' ? NUM_OPS : ENUM_OPS))
const rangeHint = computed(() =>
  meta.value?.kind === 'numeric' && meta.value.min != null ? `${meta.value.min} – ${meta.value.max}` : 'value')

async function loadMeta() {
  loading.value = true
  meta.value = null
  try {
    meta.value = await fetchFieldValues(props.row.field)
    // keep the operator valid for the new field kind
    if (!ops.value.includes(props.row.op)) props.row.op = ops.value[0]
  } catch { meta.value = { kind: 'text' } }
  finally { loading.value = false }
}

function onFieldChange() {
  props.row.value = ''
  loadMeta()
}

watch(() => props.row.field, () => { if (!meta.value) loadMeta() })
onMounted(loadMeta)
</script>

<style scoped>
.arow { display: flex; gap: 4px; align-items: center; }
.inp { background: #0b0c0e; color: #d8d9da; border: 1px solid #2c2f36; border-radius: 3px; padding: 5px 7px; font-size: 12px; color-scheme: dark; }
.inp:focus { outline: none; border-color: #33b5e5; }
.field { width: 150px; } .op { width: 58px; } .val { width: 160px; }
.hint { color: #8e8e8e; font-size: 12px; width: 160px; }
.rm { background: #2c3235; border: 1px solid #3a4147; color: #d8d9da; border-radius: 3px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
.rm:hover { background: #3a4147; }
</style>
