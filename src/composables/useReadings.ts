import { ref } from 'vue'
import { type BpReading, type BpReadingWithMeta, getTodayStorageKey } from '../utils/bp'
import { syncData } from '../services/driveSync'

// ── Shared localStorage helpers ────────────────────────────────────────────────

function readRaw(key: string): BpReading[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}

/** Load every active (non-deleted) reading across all dates, newest first. */
export function loadAllReadings(): BpReadingWithMeta[] {
  const keys = Object.keys(localStorage)
    .filter(k => k.startsWith('bpm_readings_'))
    .sort((a, b) => b.localeCompare(a))

  const result: BpReadingWithMeta[] = []
  for (const key of keys) {
    const dateKey = key.replace('bpm_readings_', '')
    readRaw(key).forEach((r, idx) => {
      if (!r.deleted) result.push({ ...r, dateKey, index: idx })
    })
  }
  return result.sort((a, b) => b.timestamp - a.timestamp)
}

/** Soft-delete a reading by timestamp. */
export function softDelete(dateKey: string, timestamp: number) {
  const key = `bpm_readings_${dateKey}`
  const arr = readRaw(key).map(e => e.timestamp === timestamp ? { ...e, deleted: true } : e)
  localStorage.setItem(key, JSON.stringify(arr))
  syncData()
}

/** Insert a (potentially backdated) reading for any date. */
export function backdateReading(dateKey: string, entry: BpReading) {
  const key = `bpm_readings_${dateKey}`
  const arr = [...readRaw(key), entry].sort((a, b) => b.timestamp - a.timestamp)
  localStorage.setItem(key, JSON.stringify(arr))
  syncData()
}

// ── Today-readings composable (used by App.vue's Today tab) ───────────────────

export function useReadings() {
  const todayReadings = ref<BpReading[]>([])

  function loadToday() {
    todayReadings.value = readRaw(getTodayStorageKey()).filter(r => !r.deleted)
  }

  function persistToday() {
    const key = getTodayStorageKey()
    try {
      const deleted = readRaw(key).filter(r => r.deleted)
      const combined = [...todayReadings.value, ...deleted]
        .sort((a, b) => b.timestamp - a.timestamp)
      localStorage.setItem(key, JSON.stringify(combined))
    } catch {
      localStorage.setItem(key, JSON.stringify(todayReadings.value))
    }
    syncData()
  }

  function addReading(entry: BpReading) {
    todayReadings.value = [entry, ...todayReadings.value]
      .sort((a, b) => b.timestamp - a.timestamp)
    persistToday()
  }

  function updateReading(index: number, entry: BpReading) {
    const updated = [...todayReadings.value]
    updated[index] = entry
    todayReadings.value = updated.sort((a, b) => b.timestamp - a.timestamp)
    persistToday()
  }

  return { todayReadings, loadToday, addReading, updateReading }
}
