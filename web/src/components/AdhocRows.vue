<template>
  <div class="adhoc" v-if="store.adhoc.length">
    <AdhocRow v-for="(a, i) in store.adhoc" :key="i" :row="a" :fields="adhocFields"
              @apply="store.applyAdhoc()" @remove="store.removeAdhoc(i)" />
    <button class="btn sm apply" @click="store.applyAdhoc()">apply</button>
  </div>
</template>

<script setup>
import { useFilterStore } from '../stores/filterStore.js'
import AdhocRow from './AdhocRow.vue'

const store = useFilterStore()
const adhocFields = ['FOLLOWUP_COUNT', 'STATE', 'SEX', 'DIED', 'HOSPITAL', 'L_THREAT', 'DISABLE', 'RECOVD',
  'ER_VISIT', 'ER_ED_VISIT', 'X_STAY', 'BIRTH_DEFECT', 'OFC_VISIT', 'V_ADMINBY', 'V_FUNDBY', 'AGE_YRS',
  'NUMDAYS', 'NUM_VAX', 'IS_DOMESTIC', 'REACTIONS', 'VAX_TYPES', 'HAS_DATA', 'SYMPTOMS', 'VAX_MANU']
</script>
