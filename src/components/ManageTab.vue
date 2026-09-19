<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NCard, NButton, NEmpty, NModal } from 'naive-ui'
import { syncData } from '../services/driveSync'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BpReading {
  systolic: number
  diastolic: number
  timestamp: number
  deleted?: boolean
}

interface BpReadingWithMeta extends BpReading {
  dateKey: string  // e.g. "2026-09-15"
  index: number    // index within that day's array
}

// ─── State ────────────────────────────────────────────────────────────────────

const allReadings = ref<BpReadingWithMeta[]>([])

// Add-entry form
const showAddModal = ref(false)
const formDate = ref('')
const formTime = ref('')
const formSystolic = ref<number | null>(null)
const formDiastolic = ref<number | null>(null)
const formError = ref('')

// Delete confirmation
const showDeleteModal = ref(false)
const pendingDelete = ref<BpReadingWithMeta | null>(null)

// ─── Load all readings ────────────────────────────────────────────────────────

function loadAllReadings() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('bpm_readings_'))
  keys.sort((a, b) => b.localeCompare(a)) // newest date first

  const result: BpReadingWithMeta[] = []
  for (const key of keys) {
    const dateKey = key.replace('bpm_readings_', '')
    try {
      const arr: BpReading[] = JSON.parse(localStorage.getItem(key) || '[]')
      arr.forEach((r, idx) => {
        if (!r.deleted) result.push({ ...r, dateKey, index: idx })
      })
    } catch {
      // skip malformed
    }
  }

  // Sort overall: newest timestamp first
  result.sort((a, b) => b.timestamp - a.timestamp)
  allReadings.value = result
}

onMounted(loadAllReadings)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts)
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

function bpCategory(sys: number, dia: number) {
  if (sys < 120 && dia < 80) return { label: 'Normal', cls: 'text-emerald-500' }
  if (sys < 130 && dia < 80) return { label: 'Elevated', cls: 'text-yellow-500' }
  if (sys < 140 || dia < 90) return { label: 'High Stage 1', cls: 'text-orange-500' }
  return { label: 'High Stage 2', cls: 'text-red-500' }
}

function adjustValue(field: 'systolic' | 'diastolic', delta: number) {
  if (field === 'systolic') {
    formSystolic.value = Math.max(0, (formSystolic.value ?? 0) + delta)
  } else {
    formDiastolic.value = Math.max(0, (formDiastolic.value ?? 0) + delta)
  }
}

// ─── Add entry ────────────────────────────────────────────────────────────────

function openAddModal() {
  // Default to today's date and current time
  const now = new Date()
  formDate.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  formTime.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  formSystolic.value = null
  formDiastolic.value = null
  formError.value = ''
  showAddModal.value = true
}

function saveEntry() {
  formError.value = ''

  if (!formDate.value) {
    formError.value = 'Please select a date.'
    return
  }
  if (!formTime.value) {
    formError.value = 'Please select a time.'
    return
  }
  if (!formSystolic.value || formSystolic.value <= 0) {
    formError.value = 'Please enter a valid systolic value.'
    return
  }
  if (!formDiastolic.value || formDiastolic.value <= 0) {
    formError.value = 'Please enter a valid diastolic value.'
    return
  }
  if (formDiastolic.value >= formSystolic.value) {
    formError.value = 'Diastolic must be lower than systolic.'
    return
  }

  // Build timestamp from selected date + time
  const [year, month, day] = formDate.value.split('-').map(Number)
  const [hour, minute] = formTime.value.split(':').map(Number)
  const ts = new Date(year!, (month! - 1), day!, hour!, minute!, 0, 0).getTime()

  const dateKey = formDate.value
  const storageKey = `bpm_readings_${dateKey}`
  let existing: BpReading[] = []
  try {
    existing = JSON.parse(localStorage.getItem(storageKey) || '[]')
  } catch {
    existing = []
  }

  const newEntry: BpReading = {
    systolic: formSystolic.value,
    diastolic: formDiastolic.value,
    timestamp: ts,
  }

  // Insert and keep sorted newest-first within the day
  existing.push(newEntry)
  existing.sort((a, b) => b.timestamp - a.timestamp)
  localStorage.setItem(storageKey, JSON.stringify(existing))
  syncData()

  showAddModal.value = false
  loadAllReadings()
}

// ─── Delete entry ─────────────────────────────────────────────────────────────

function confirmDelete(reading: BpReadingWithMeta) {
  pendingDelete.value = reading
  showDeleteModal.value = true
}

function executeDelete() {
  const r = pendingDelete.value
  if (!r) return

  const storageKey = `bpm_readings_${r.dateKey}`
  try {
    let existing: BpReading[] = JSON.parse(localStorage.getItem(storageKey) || '[]')
    // Soft delete by matching timestamp
    existing = existing.map(e => e.timestamp === r.timestamp ? { ...e, deleted: true } : e)
    localStorage.setItem(storageKey, JSON.stringify(existing))
    syncData()
  } catch {
    // ignore
  }

  showDeleteModal.value = false
  pendingDelete.value = null
  loadAllReadings()
}

// ─── Grouped readings for display ─────────────────────────────────────────────

interface GroupedDay {
  dateKey: string
  readings: BpReadingWithMeta[]
}

const groupedReadings = computed<GroupedDay[]>(() => {
  const map = new Map<string, BpReadingWithMeta[]>()
  for (const r of allReadings.value) {
    if (!map.has(r.dateKey)) map.set(r.dateKey, [])
    map.get(r.dateKey)!.push(r)
  }
  // Sort groups by date descending
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, readings]) => ({ dateKey, readings }))
})

function friendlyDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y!, (m! - 1), d!)
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div class="flex flex-col h-full overflow-y-auto no-scrollbar pb-32 px-4 pt-2 transition-colors duration-500">

    <!-- Add Entry Button -->
    <button
      @click="openAddModal"
      class="w-full py-4 rounded-2xl font-extrabold text-white text-sm uppercase tracking-widest shadow-lg active:scale-95 transition-all bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 mb-6"
    >
      + Add / Backdate Entry
    </button>

    <!-- Empty state -->
    <n-empty v-if="groupedReadings.length === 0" description="No readings yet" class="my-10" />

    <!-- Grouped list -->
    <div v-else class="flex flex-col gap-6">
      <div v-for="group in groupedReadings" :key="group.dateKey">
        <!-- Date heading -->
        <div class="flex items-center gap-2 mb-2 px-1">
          <span class="text-xs font-extrabold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            {{ friendlyDate(group.dateKey) }}
          </span>
          <div class="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        </div>

        <!-- Readings for this day -->
        <div class="flex flex-col gap-2">
          <n-card
            v-for="reading in group.readings"
            :key="reading.timestamp"
            class="w-full rounded-2xl shadow-sm border-0 bg-white dark:bg-slate-800"
            :bordered="false"
            size="small"
          >
            <div class="flex justify-between items-center px-2 py-1">
              <!-- Left: time + category -->
              <div class="flex flex-col gap-0.5">
                <div class="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {{ formatTime(reading.timestamp) }}
                </div>
                <span
                  class="text-[11px] font-extrabold uppercase tracking-widest"
                  :class="bpCategory(reading.systolic, reading.diastolic).cls"
                >
                  {{ bpCategory(reading.systolic, reading.diastolic).label }}
                </span>
              </div>

              <!-- Right: values + delete -->
              <div class="flex items-center gap-3">
                <div class="flex items-end gap-1">
                  <div class="flex flex-col items-center">
                    <span class="text-2xl font-black tabular-nums text-slate-800 dark:text-slate-100">{{ reading.systolic }}</span>
                    <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">SYS</span>
                  </div>
                  <span class="text-slate-400 font-black text-lg mb-2 mx-0.5">/</span>
                  <div class="flex flex-col items-center">
                    <span class="text-xl font-black tabular-nums text-slate-600 dark:text-slate-300">{{ reading.diastolic }}</span>
                    <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">DIA</span>
                  </div>
                  <span class="ml-1 mb-1 text-[9px] font-bold text-slate-400 uppercase self-end">mmHg</span>
                </div>

                <!-- Delete button -->
                <button
                  @click="confirmDelete(reading)"
                  class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all active:scale-90 shrink-0"
                  title="Delete this reading"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                  </svg>
                </button>
              </div>
            </div>
          </n-card>
        </div>
      </div>
    </div>

    <!-- ── Add Entry Modal ──────────────────────────────────────────────── -->
    <n-modal v-model:show="showAddModal">
      <n-card
        style="width: 340px; border-radius: 28px;"
        title="Add BP Entry"
        :bordered="false"
        size="huge"
        role="dialog"
        aria-modal="true"
        class="shadow-2xl"
      >
        <div class="flex flex-col gap-5 pt-2">

          <!-- Date -->
          <div>
            <label class="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-2 block">Date</label>
            <input
              type="date"
              v-model="formDate"
              :style="{ colorScheme: 'light' }"
              class="w-full rounded-2xl px-4 py-3 text-base font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-4 focus:ring-violet-500/30 transition-shadow"
            />
          </div>

          <!-- Time -->
          <div>
            <label class="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-2 block">Time</label>
            <input
              type="time"
              v-model="formTime"
              :style="{ colorScheme: 'light' }"
              class="w-full rounded-2xl px-4 py-3 text-3xl font-black tabular-nums tracking-tight bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-4 focus:ring-violet-500/30 transition-shadow"
            />
          </div>

          <!-- Systolic -->
          <div>
            <label class="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-2 block">Systolic (mmHg)</label>
            <div class="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 rounded-2xl px-3 py-2.5">
              <button
                type="button"
                @click="adjustValue('systolic', -1)"
                class="shrink-0 w-12 h-12 rounded-xl bg-white dark:bg-slate-700 shadow-sm active:scale-95 transition-transform flex items-center justify-center text-2xl font-black text-slate-600 dark:text-slate-200"
              >−</button>
              <div class="flex-1 flex flex-col items-center min-w-0">
                <input
                  type="number"
                  inputmode="numeric"
                  step="1"
                  min="0"
                  max="300"
                  v-model.number="formSystolic"
                  placeholder="120"
                  class="w-full bg-transparent text-center text-4xl font-black tabular-nums text-slate-800 dark:text-white outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest -mt-1">SYS</span>
              </div>
              <button
                type="button"
                @click="adjustValue('systolic', 1)"
                class="shrink-0 w-12 h-12 rounded-xl bg-white dark:bg-slate-700 shadow-sm active:scale-95 transition-transform flex items-center justify-center text-2xl font-black text-slate-600 dark:text-slate-200"
              >+</button>
            </div>
          </div>

          <!-- Diastolic -->
          <div>
            <label class="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-2 block">Diastolic (mmHg)</label>
            <div class="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 rounded-2xl px-3 py-2.5">
              <button
                type="button"
                @click="adjustValue('diastolic', -1)"
                class="shrink-0 w-12 h-12 rounded-xl bg-white dark:bg-slate-700 shadow-sm active:scale-95 transition-transform flex items-center justify-center text-2xl font-black text-slate-600 dark:text-slate-200"
              >−</button>
              <div class="flex-1 flex flex-col items-center min-w-0">
                <input
                  type="number"
                  inputmode="numeric"
                  step="1"
                  min="0"
                  max="200"
                  v-model.number="formDiastolic"
                  placeholder="80"
                  class="w-full bg-transparent text-center text-4xl font-black tabular-nums text-slate-800 dark:text-white outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest -mt-1">DIA</span>
              </div>
              <button
                type="button"
                @click="adjustValue('diastolic', 1)"
                class="shrink-0 w-12 h-12 rounded-xl bg-white dark:bg-slate-700 shadow-sm active:scale-95 transition-transform flex items-center justify-center text-2xl font-black text-slate-600 dark:text-slate-200"
              >+</button>
            </div>
          </div>

          <!-- Error -->
          <div v-if="formError" class="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm font-semibold flex items-start gap-2 leading-tight">
            <svg class="shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>{{ formError }}</span>
          </div>

        </div>

        <template #footer>
          <div class="flex items-center gap-3 mt-2 w-full justify-end">
            <n-button size="large" @click="showAddModal = false" class="font-bold">Cancel</n-button>
            <n-button type="primary" size="large" @click="saveEntry" class="font-bold px-6 shadow-md"
              style="background: linear-gradient(to right, #7c3aed, #9333ea); border: none;"
            >Save</n-button>
          </div>
        </template>
      </n-card>
    </n-modal>

    <!-- ── Delete Confirmation Modal ───────────────────────────────────── -->
    <n-modal v-model:show="showDeleteModal">
      <n-card
        style="width: 320px; border-radius: 24px;"
        title="Delete Reading"
        :bordered="false"
        size="medium"
        role="dialog"
        aria-modal="true"
        class="shadow-2xl"
      >
        <div class="flex flex-col gap-3 pt-1">
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Are you sure you want to delete this reading?
          </p>
          <div v-if="pendingDelete" class="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-between">
            <div class="text-xs font-semibold text-slate-500 dark:text-slate-400">
              <div>{{ pendingDelete.dateKey }}</div>
              <div>{{ formatTime(pendingDelete.timestamp) }}</div>
            </div>
            <div class="flex items-end gap-1">
              <span class="text-2xl font-black tabular-nums text-slate-800 dark:text-slate-100">{{ pendingDelete.systolic }}</span>
              <span class="font-black text-slate-400 mb-0.5">/</span>
              <span class="text-xl font-black tabular-nums text-slate-600 dark:text-slate-300">{{ pendingDelete.diastolic }}</span>
              <span class="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5 self-end">mmHg</span>
            </div>
          </div>
          <p class="text-xs text-slate-400 dark:text-slate-500">This action cannot be undone.</p>
        </div>

        <template #footer>
          <div class="flex items-center gap-3 mt-2 w-full justify-end">
            <n-button size="large" @click="showDeleteModal = false" class="font-bold">Cancel</n-button>
            <n-button
              size="large"
              @click="executeDelete"
              class="font-bold px-6 shadow-md"
              style="background: #dc2626; color: white; border: none;"
            >Delete</n-button>
          </div>
        </template>
      </n-card>
    </n-modal>

  </div>
</template>
