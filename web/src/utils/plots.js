// Observable Plot builders for the dashboard panels (Grafana-dark aesthetic).
import * as Plot from '@observablehq/plot'

const AXIS = '#8e8e8e'
const GRID = '#2c2f36'
const GREEN = '#7EB26D'   // Grafana classic green (VAERS EVENTS / Num Vacc.)
const TEXT = '#d8d9da'

// Grafana "classic" categorical palette — used for per-bar coloring + pie.
export const PALETTE = [
  '#7EB26D', '#EAB839', '#6ED0E0', '#EF843C', '#E24D42', '#1F78C1', '#BA43A9', '#705DA0',
  '#508642', '#CCA300', '#447EBC', '#C15C17', '#890F02', '#0A437C', '#6D1F62', '#584477',
  '#B7DBAB', '#F4D598', '#70DBED', '#F9BA8F', '#F29191', '#82B5D8', '#E5A8E2', '#AEA2E0',
]

const RED = '#E24D42'    // Grafana classic red (Deaths)

const baseStyle = { background: 'transparent', color: TEXT, fontSize: '11px' }
const colored = (rows) => rows.map((d, i) => ({ ...d, _c: PALETTE[i % PALETTE.length] }))

// Empty-data placeholder — keeps callers from having to special-case a blank panel.
function emptyPlot(width, height) {
  return Plot.plot({ width, height, style: baseStyle, marks: [] })
}

// Attach pointer cursor + click → onClick(datum) to the <rect> elements of a bar mark,
// in data order (Plot renders a single rect/barY|barX mark in input-data order).
function bindBarClicks(node, data, onClick) {
  if (!onClick || !data || !data.length) return node
  const rects = node.querySelectorAll('rect')
  rects.forEach((el, i) => {
    const d = data[i]
    if (!d) return
    el.style.cursor = 'pointer'
    el.addEventListener('click', () => onClick(d))
  })
  return node
}

export function fmt(n) {
  if (n == null) return '0'
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}

// ~7 evenly-spaced year ticks (avoids one label per bar).
function yearTicks(data) {
  const ys = data.map((d) => d.year).filter((y) => y != null)
  if (!ys.length) return undefined
  const lo = Math.min(...ys), hi = Math.max(...ys)
  const step = Math.max(1, Math.ceil((hi - lo) / 7 / 5) * 5)
  const out = []
  for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) out.push(y)
  return out.length ? out : undefined
}

// Events per year — green bars over VAX_DATE year.
export function eventsByYear(data, width, height = 230) {
  return Plot.plot({
    width, height, marginLeft: 46, marginBottom: 26, style: baseStyle,
    x: { label: null, tickFormat: 'd', ticks: yearTicks(data), tickRotate: 0 },
    y: { label: null, grid: true, tickFormat: fmt },
    marks: [
      Plot.rectY(data, { x: 'year', y: 'count', fill: GREEN, inset: 0.5,
        title: (d) => `${d.year}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
}

// Onset days 0–19 — per-bar categorical colors (matches Grafana).
export function onsetDays(data, width, height = 210) {
  return Plot.plot({
    width, height, marginLeft: 46, marginBottom: 24, style: baseStyle,
    x: { label: null, domain: data.map((d) => d.day), tickFormat: 'd' },
    y: { label: null, grid: true, tickFormat: fmt },
    color: { type: 'identity' },
    marks: [
      Plot.barY(colored(data), { x: 'day', y: 'count', fill: '_c', title: (d) => `day ${d.day}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
}

// Number of vaccines per report 1–8 — green bars.
export function numVax(data, width, height = 210) {
  return Plot.plot({
    width, height, marginLeft: 46, marginBottom: 24, style: baseStyle,
    x: { label: null, domain: data.map((d) => d.num), tickFormat: 'd' },
    y: { label: null, grid: true, tickFormat: fmt },
    marks: [
      Plot.barY(data, { x: 'num', y: 'count', fill: GREEN, title: (d) => `${d.num}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
}

// Age buckets — per-bar categorical colors.
export function ageBuckets(data, width, height = 210, onClick) {
  if (!data || !data.length) return emptyPlot(width, height)
  const node = Plot.plot({
    width, height, marginLeft: 46, marginBottom: 28, style: baseStyle,
    x: { label: null, domain: data.map((d) => d.label) },
    y: { label: null, grid: true, tickFormat: fmt },
    color: { type: 'identity' },
    marks: [
      Plot.barY(colored(data), { x: 'label', y: 'count', fill: '_c', title: (d) => `${d.label}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
  return bindBarClicks(node, data, onClick)
}

// Deaths per DATEDIED year — red bars (deaths lacking a death date are excluded upstream).
export function deathsByYear(data, width, height = 210) {
  if (!data || !data.length) return emptyPlot(width, height)
  return Plot.plot({
    width, height, marginLeft: 46, marginBottom: 26, style: baseStyle,
    x: { label: null, tickFormat: 'd', ticks: yearTicks(data), tickRotate: 0 },
    y: { label: null, grid: true, tickFormat: fmt },
    marks: [
      Plot.rectY(data, { x: 'year', y: 'count', fill: RED, inset: 0.5,
        title: (d) => `${d.year}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
}

// Report lag (RECVDATE - VAX_DATE) — 7 fixed bins, categorical, keep the given order.
export function lagBins(data, width, height = 210) {
  if (!data || !data.length) return emptyPlot(width, height)
  return Plot.plot({
    width, height, marginLeft: 46, marginBottom: 28, style: baseStyle,
    x: { label: null, domain: data.map((d) => d.bucket) },
    y: { label: null, grid: true, tickFormat: fmt },
    marks: [
      Plot.barY(data, { x: 'bucket', y: 'count', fill: GREEN, title: (d) => `${d.bucket}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
}

// Age 0-19, single-year buckets, zero-filled — clickable per single year.
export function ageU20(data, width, height = 210, onClick) {
  if (!data || !data.length) return emptyPlot(width, height)
  const node = Plot.plot({
    width, height, marginLeft: 46, marginBottom: 24, style: baseStyle,
    x: { label: null, domain: data.map((d) => d.age), tickFormat: 'd' },
    y: { label: null, grid: true, tickFormat: fmt },
    marks: [
      Plot.barY(data, { x: 'age', y: 'count', fill: GREEN, title: (d) => `age ${d.age}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
  return bindBarClicks(node, data, onClick)
}

// Symptoms — horizontal bars, dual mode: 'top' (background count) or 'significant' (JLH
// score vs. background, tooltip shows fg_n/bg_n).
function truncateLabel(s, n = 28) {
  if (s == null) return ''
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
export function symptomsBar(rows, mode, width, height = 300, onClick) {
  if (!rows || !rows.length) return emptyPlot(width, height)
  const xField = mode === 'significant' ? 'score' : 'count'
  const node = Plot.plot({
    width, height, marginLeft: 160, marginBottom: 24, style: baseStyle,
    y: { label: null, domain: rows.map((d) => d.symptom), tickFormat: (d) => truncateLabel(d) },
    x: { label: null, grid: true, tickFormat: mode === 'significant' ? (v) => v.toFixed(2) : fmt },
    marks: [
      Plot.barX(rows, {
        y: 'symptom', x: xField, fill: GREEN,
        title: (d) => mode === 'significant'
          ? `${d.symptom}\nscore ${d.score.toFixed(3)} (fg ${fmt(d.fg_n)} / bg ${fmt(d.bg_n)})`
          : `${d.symptom}: ${fmt(d.count)}`,
      }),
      Plot.ruleX([0], { stroke: GRID }),
    ],
  })
  return bindBarClicks(node, rows, onClick)
}

// Small green sparkline for the Total stat.
export function sparkline(data, width = 220, height = 44) {
  if (!data || !data.length) return document.createElement('div')
  return Plot.plot({
    width, height, margin: 0, style: baseStyle, axis: null,
    x: { type: 'point', axis: null }, y: { axis: null },
    marks: [
      Plot.areaY(data, { x: 'period', y: 'count', fill: GREEN, fillOpacity: 0.22 }),
      Plot.lineY(data, { x: 'period', y: 'count', stroke: GREEN, strokeWidth: 1.5 }),
    ],
  })
}

// Generic pie (hand-rolled SVG — Plot has no pie mark).
export function pie(data, { getLabel = (d) => d.label, getCount = (d) => d.count, onClick, size = 190 } = {}) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.setAttribute('width', size)
  svg.setAttribute('height', size)
  const total = data.reduce((s, d) => s + getCount(d), 0)
  if (!data.length || !total) return svg
  const cx = size / 2, cy = size / 2, r = size / 2 - 3
  let a0 = -Math.PI / 2
  data.forEach((d, i) => {
    const count = getCount(d)
    const frac = count / total
    const a1 = a0 + frac * 2 * Math.PI
    const large = frac > 0.5 ? 1 : 0
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
    // A single slice at ~100% has coincident start/end points, so an arc path draws
    // nothing — draw a full circle instead (common now that a sex-slice click filters
    // to one sex, forcing a 100% slice on reload).
    const path = document.createElementNS(ns, frac > 0.999 ? 'circle' : 'path')
    if (frac > 0.999) {
      path.setAttribute('cx', cx); path.setAttribute('cy', cy); path.setAttribute('r', r)
    } else {
      path.setAttribute('d', `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large},1 ${x1},${y1} Z`)
    }
    path.setAttribute('fill', PALETTE[i % PALETTE.length])
    path.setAttribute('stroke', '#161719')
    path.setAttribute('stroke-width', '1')
    const t = document.createElementNS(ns, 'title')
    t.textContent = `${getLabel(d)}: ${fmt(count)} (${(frac * 100).toFixed(1)}%)`
    path.appendChild(t)
    if (onClick) {
      path.style.cursor = 'pointer'
      path.addEventListener('click', () => onClick(d))
    }
    svg.appendChild(path)
    a0 = a1
  })
  return svg
}

// Thin wrappers over the generic pie — legends in Dashboard.vue key off the raw arrays.
export function reactionsPie(data, onClick, size = 190) {
  return pie(data, { getLabel: (d) => d.reaction, getCount: (d) => d.count, onClick, size })
}
export function sexPie(data, onClick, size = 190) {
  return pie(data, { getLabel: (d) => d.sex, getCount: (d) => d.count, onClick, size })
}
