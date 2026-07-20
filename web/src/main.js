import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { createPinia } from 'pinia'
import App from './App.vue'
import DashboardLayout from './components/DashboardLayout.vue'
import './assets/dashboard.css'

// Five focused views under one persistent layout (filter bar + nav + cases
// table); the filter context carries over in full on view switch.
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: DashboardLayout,
      children: [
        { path: '', name: 'overview', component: () => import('./views/Overview.vue'), meta: { title: 'VAERS — Overview' } },
        { path: 'people', name: 'people', component: () => import('./views/People.vue'), meta: { title: 'VAERS — People' } },
        { path: 'vaccine', name: 'vaccine', component: () => import('./views/Vaccine.vue'), meta: { title: 'VAERS — Vaccine' } },
        { path: 'all', name: 'all', component: () => import('./views/AllReports.vue'), meta: { title: 'VAERS — All Reports' } },
        { path: 'data-quality', name: 'data-quality', component: () => import('./views/DataQuality.vue'), meta: { title: 'VAERS — Data Quality' } },
      ],
    },
  ],
})

router.beforeEach((to) => {
  document.title = to.meta.title || 'VAERS Dashboard'
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
