import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { createPinia } from 'pinia'
import App from './App.vue'
import Dashboard from './views/Dashboard.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard, name: 'Dashboard', meta: { title: 'VAERS Dashboard' } },
  ],
})

router.beforeEach((to) => {
  document.title = to.meta.title || 'VAERS Dashboard'
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
