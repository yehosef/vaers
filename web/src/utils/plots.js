// Observable Plot builders for the dashboard panels (Grafana-dark aesthetic).
import * as Plot from '@observablehq/plot'

const AXIS = '#8e8e8e'
const GRID = '#2c2f36'
const BAR = '#3274d9'      // Grafana blue
const BAR2 = '#56a64b'     // Grafana green
const BAR3 = '#e0b400'     // Grafana yellow
const TEXT = '#d8d9da'

const PIE_COLORS = ['#3274d9', '#56a64b', '#e0b400', '#e02f44', '#b877d9', '#ff780a', '#8ab8ff', '#f2cc0c']

const baseStyle = { background: 'transparent', color: TEXT, fontSize: '11px' }

export function fmt(n) {
  if (n == null) return '0'
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}

// Events per year — vertical bars over VAX_DATE year.
export function eventsByYear(data, width) {
  return Plot.plot({
    width, height: 240, marginLeft: 52, marginBottom: 34, style: baseStyle,
    x: { label: null, tickFormat: 'd', ticks: 8 },
    y: { label: null, grid: true, tickFormat: fmt },
    marks: [
      Plot.rectY(data, { x: 'year', y: 'count', fill: BAR, inset: 0.5,
        title: (d) => `${d.year}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
}

// Onset days 0–19.
export function onsetDays(data, width) {
  return Plot.plot({
    width, height: 220, marginLeft: 48, marginBottom: 30, style: baseStyle,
    x: { label: 'days', domain: data.map((d) => d.day), tickFormat: 'd' },
    y: { label: null, grid: true, tickFormat: fmt },
    marks: [
      Plot.barY(data, { x: 'day', y: 'count', fill: BAR3, title: (d) => `day ${d.day}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
}

// Number of vaccines per report 1–8.
export function numVax(data, width) {
  return Plot.plot({
    width, height: 220, marginLeft: 48, marginBottom: 30, style: baseStyle,
    x: { label: '# vaccines', domain: data.map((d) => d.num), tickFormat: 'd' },
    y: { label: null, grid: true, tickFormat: fmt },
    marks: [
      Plot.barY(data, { x: 'num', y: 'count', fill: BAR2, title: (d) => `${d.num}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
}

// Age buckets.
export function ageBuckets(data, width) {
  return Plot.plot({
    width, height: 220, marginLeft: 48, marginBottom: 34, style: baseStyle,
    x: { label: 'age', domain: data.map((d) => d.label) },
    y: { label: null, grid: true, tickFormat: fmt },
    marks: [
      Plot.barY(data, { x: 'label', y: 'count', fill: BAR, title: (d) => `${d.label}: ${fmt(d.count)}` }),
      Plot.ruleY([0], { stroke: GRID }),
    ],
  })
}

// Small sparkline for the Total stat.
export function sparkline(data, width = 220, height = 40) {
  if (!data || !data.length) return document.createElement('div')
  return Plot.plot({
    width, height, margin: 0, style: baseStyle, axis: null,
    x: { type: 'point', axis: null }, y: { axis: null },
    marks: [
      Plot.areaY(data, { x: 'period', y: 'count', fill: BAR, fillOpacity: 0.25 }),
      Plot.lineY(data, { x: 'period', y: 'count', stroke: BAR, strokeWidth: 1.5 }),
    ],
  })
}

// Reactions pie (hand-rolled SVG — Plot has no pie mark).
export function reactionsPie(data, size = 220) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.setAttribute('width', size)
  svg.setAttribute('height', size)
  const total = data.reduce((s, d) => s + d.count, 0)
  if (!total) return svg
  const cx = size / 2, cy = size / 2, r = size / 2 - 4
  let a0 = -Math.PI / 2
  data.forEach((d, i) => {
    const frac = d.count / total
    const a1 = a0 + frac * 2 * Math.PI
    const large = frac > 0.5 ? 1 : 0
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large},1 ${x1},${y1} Z`)
    path.setAttribute('fill', PIE_COLORS[i % PIE_COLORS.length])
    path.setAttribute('stroke', '#161719')
    path.setAttribute('stroke-width', '1')
    const t = document.createElementNS(ns, 'title')
    t.textContent = `${d.reaction}: ${fmt(d.count)} (${(frac * 100).toFixed(1)}%)`
    path.appendChild(t)
    svg.appendChild(path)
    a0 = a1
  })
  return svg
}

export { PIE_COLORS }
