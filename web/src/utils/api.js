// API client for the VAERS dashboard backend (proxied to :3001 via Vite).
import axios from 'axios'

const http = axios.create({ baseURL: '/api', timeout: 60000 })

// Build the shared filter payload the backend expects.
export function filterPayload(f) {
  return {
    query: f.query || '',
    vax_types: f.vaxTypes || [],
    adhoc: (f.adhoc || []).filter((a) => a.field && a.value !== '' && a.value != null),
    date_from: f.dateFrom || null,
    date_to: f.dateTo || null,
    rate: f.rate || 100,
  }
}

export async function fetchDashboard(f) {
  const { data } = await http.post('/dashboard', filterPayload(f))
  return data
}

export async function fetchCases(f, limit, offset) {
  const { data } = await http.post('/cases', { ...filterPayload(f), limit, offset })
  return data
}

export async function fetchFieldValues(field) {
  const { data } = await http.get('/field-values', { params: { field } })
  return data
}

export async function fetchCase(vaersId) {
  const { data } = await http.get(`/case/${encodeURIComponent(vaersId)}`)
  return data
}

export async function fetchVaxTypes() {
  const { data } = await http.get('/filters/vax-types')
  return data.vax_types
}

export async function fetchStatus() {
  const { data } = await http.get('/status')
  return data
}
