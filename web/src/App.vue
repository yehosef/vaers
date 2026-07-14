<template>
  <div id="app">
    <header class="topbar">
      <h1><span class="brand">VAERS</span> Dashboard</h1>
      <div class="status" v-if="status">
        <span class="dot" :class="{ ok: status.status === 'connected' }"></span>
        {{ Number(status.records).toLocaleString() }} reports
      </div>
    </header>
    <main><RouterView /></main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { fetchStatus } from './utils/api.js'

const status = ref(null)
onMounted(async () => {
  try { status.value = await fetchStatus() } catch (e) { console.warn('status failed', e) }
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0c0e; color: #d8d9da; }
#app { min-height: 100vh; }
.topbar { display: flex; align-items: center; gap: 16px; padding: 12px 20px; background: #111217; border-bottom: 1px solid #2c2f36; }
.topbar h1 { font-size: 18px; font-weight: 500; }
.brand { font-weight: 800; letter-spacing: 1px; color: #fff; }
.status { margin-left: auto; font-size: 13px; color: #8e8e8e; display: flex; align-items: center; gap: 7px; }
.status .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7078; }
.status .dot.ok { background: #56a64b; }
main { padding: 16px 20px; max-width: 1500px; margin: 0 auto; }
</style>
