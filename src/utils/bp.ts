// ─── Shared BP types & pure utility functions ─────────────────────────────────
// Single source of truth — imported by all components, the store, and composables.

export interface BpReading {
  systolic: number
  diastolic: number
  timestamp: number
  deleted?: boolean
}

export interface BpReadingWithMeta extends BpReading {
  dateKey: string  // e.g. "2026-09-15"
  index: number    // index within that day's localStorage array
}

export interface BpCategory {
  label: string
  /** Lighter colour for use on a coloured card (white variants) */
  color: string
  /** Standard colour for use on a neutral background */
  cls: string
}

/** Classify a BP reading following standard AHA thresholds. */
export function bpCategory(sys: number, dia: number): BpCategory {
  if (sys < 120 && dia < 80)  return { label: 'Normal',      color: 'text-emerald-300', cls: 'text-emerald-500' }
  if (sys < 130 && dia < 80)  return { label: 'Elevated',    color: 'text-yellow-300',  cls: 'text-yellow-500'  }
  if (sys < 140 || dia < 90)  return { label: 'High Stage 1',color: 'text-orange-300',  cls: 'text-orange-500'  }
  return                               { label: 'High Stage 2',color: 'text-red-300',     cls: 'text-red-500'     }
}

/** Format a unix-ms timestamp as "h:mm AM/PM". */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

/** Return the localStorage key for today's readings. */
export function getTodayStorageKey(): string {
  const d = new Date()
  return `bpm_readings_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
