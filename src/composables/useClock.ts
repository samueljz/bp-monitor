import { ref, computed, onMounted, onUnmounted } from 'vue'

/**
 * Provides a reactive live clock that ticks every second.
 * Also exposes `todayDateKey` so callers can watch for midnight rollovers.
 */
export function useClock() {
  const now = ref(new Date())
  let timer: number | null = null

  onMounted(() => {
    timer = window.setInterval(() => {
      now.value = new Date()
    }, 1000)
  })

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer)
  })

  const timeParts = computed(() => {
    const s = now.value.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
    const parts = s.split(' ')
    return { time: parts[0], ampm: parts[1] }
  })

  const dateString = computed(() =>
    now.value.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  )

  /** YYYY-MM-DD string for today. Watch this to detect midnight rollovers. */
  const todayDateKey = computed(() => {
    const d = now.value
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  return { now, timeParts, dateString, todayDateKey }
}
