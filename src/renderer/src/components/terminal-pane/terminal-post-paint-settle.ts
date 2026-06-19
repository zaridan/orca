export function schedulePostPaintTerminalSettle(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return () => {}
  }
  const frameId = window.requestAnimationFrame(callback)
  return () => {
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frameId)
    }
  }
}
