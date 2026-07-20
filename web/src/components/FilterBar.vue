<template>
  <div class="filterbar">
    <div class="fb-left">
      <div class="grp">
        <label class="lbl">query</label>
        <input class="inp query" type="text" placeholder="* · text · or VAERS ID"
               v-model="queryDraft"
               @keyup.enter="store.setQuery(queryDraft)" @blur="store.setQuery(queryDraft)" />
      </div>
      <VaxTypeSelect :options="store.vaxTypeOptions" :model-value="store.vaxTypes"
                     @change="store.setVaxTypes($event)" />
      <div class="grp adhoc-add">
        <label class="lbl">adhoc</label>
        <button class="plus" @click="store.addAdhoc()">＋</button>
      </div>
    </div>
    <div class="fb-right">
      <DateRange :from="store.dateFrom" :to="store.dateTo" @change="(f, t) => store.setDateRange(f, t)" />
      <span class="axis-tag" :title="axisHint">on <b>{{ store.activeView.dateField }}</b></span>
      <div class="grp">
        <label class="lbl">rate</label>
        <select class="inp" :value="store.rate" @change="store.setRate($event.target.value)">
          <option v-for="r in rateOptions" :key="r" :value="r">{{ r }} (×{{ 100 / r }})</option>
        </select>
      </div>
      <button class="btn" @click="onReset">Reset</button>
      <span v-if="store.loading" class="loading">updating…</span>
      <span v-if="store.error" class="err">{{ store.error }}</span>
    </div>
  </div>
</template>

<script setup>
// Persistent filter bar — the one filter context every view shares. The axis
// tag makes the active date field explicit: the same [from, to] range binds to
// VAX_DATE on most views but to RECVDATE on All Reports.
import { ref, computed, watch } from 'vue'
import { useFilterStore } from '../stores/filterStore.js'
import VaxTypeSelect from './VaxTypeSelect.vue'
import DateRange from './DateRange.vue'

const store = useFilterStore()
const rateOptions = [100, 50, 10, 5, 2, 1]
const queryDraft = ref(store.query)

// External resets (Reset button, future deep-links) must reflect in the draft box.
watch(() => store.query, (q) => { queryDraft.value = q })

const axisHint = computed(() => store.activeView.dateField === 'RECVDATE'
  ? 'The date range filters RECVDATE — when VAERS received the report (All Reports view).'
  : 'The date range filters VAX_DATE — the vaccination date.')

function onReset() { queryDraft.value = ''; store.reset() }
</script>
