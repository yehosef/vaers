// Render an Observable Plot node into a container, re-rendering on data change
// and container resize. build(width) returns a DOM node, or null/undefined to
// leave the container as-is (e.g. data not loaded yet — placeholder stays put).
import { watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

export function usePlot(elRef, build, deps) {
  let raf = null
  let ro = null

  const render = () => {
    const el = elRef.value
    if (!el) return
    const node = build(Math.max(el.clientWidth || 320, 160))
    if (node) el.replaceChildren(node)
  }
  const schedule = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => nextTick(render))
  }

  onMounted(() => {
    nextTick(render)
    ro = new ResizeObserver(schedule)
    if (elRef.value) ro.observe(elRef.value)
  })
  onBeforeUnmount(() => { ro?.disconnect(); cancelAnimationFrame(raf) })
  watch(deps, () => nextTick(render), { deep: true })
}
