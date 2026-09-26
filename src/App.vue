<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  NConfigProvider,
  NCard,
  NButton,
  NModal,
  NTabs,
  NTabPane,
  NDropdown,
  darkTheme
} from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import confetti from 'canvas-confetti'
import BloodPressureCard from './components/BloodPressureCard.vue'
import HistoryTab from './components/HistoryTab.vue'
import ManageTab from './components/ManageTab.vue'
import { syncData, isSignedIn, isSyncing, syncError, needsReauth, handleAuthClick, handleSignoutClick, initGoogleApi } from './services/driveSync'

// ─── Dark Mode ────────────────────────────────────────────────────────────────

const isDarkMode = ref(false)

watch(isDarkMode, (val) => {
  if (val) document.documentElement.classList.add('dark')
  else document.documentElement.classList.remove('dark')
}, { immediate: true })

const themeOverrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: '#dc2626',
    primaryColorHover: '#ef4444',
    primaryColorPressed: '#b91c1c',
    borderRadius: '12px'
  },
  Card: {
    borderRadius: '24px',
    paddingMedium: '20px'
  },
  Button: {
    borderRadiusMedium: '10px'
  }
}))

// ─── Types ────────────────────────────────────────────────────────────────────

interface BpReading {
  systolic: number
  diastolic: number
  timestamp: number
  deleted?: boolean
}

// ─── State ────────────────────────────────────────────────────────────────────

const readings = ref<BpReading[]>([])   // today's readings (newest first)
const now = ref(new Date())
let timer: number | null = null

// Modal state
const showLogModal = ref(false)
const formTimeMs = ref<number>(Date.now())
const formSystolic = ref<number | null>(null)
const formDiastolic = ref<number | null>(null)
const formError = ref('')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayDateString() {
  const d = now.value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadTodayReadings() {
  const key = `bpm_readings_${getTodayDateString()}`
  try {
    const saved = localStorage.getItem(key)
    const all: BpReading[] = saved ? JSON.parse(saved) : []
    readings.value = all.filter(r => !r.deleted)
  } catch {
    readings.value = []
  }
}

function persistReadings() {
  const key = `bpm_readings_${getTodayDateString()}`
  try {
    // Retain deleted entries from localStorage so they aren't lost when saving
    const saved = localStorage.getItem(key)
    const all: BpReading[] = saved ? JSON.parse(saved) : []
    const deletedEntries = all.filter(r => r.deleted)
    
    const combined = [...readings.value, ...deletedEntries]
    combined.sort((a, b) => b.timestamp - a.timestamp)
    localStorage.setItem(key, JSON.stringify(combined))
  } catch {
    localStorage.setItem(key, JSON.stringify(readings.value))
  }
  syncData()
}

function msToTimeString(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function timeStringToMs(t: string): number {
  const [h = 0, m = 0] = t.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

const formTimeString = computed<string>({
  get: () => msToTimeString(formTimeMs.value),
  set: (val) => { formTimeMs.value = val ? timeStringToMs(val) : Date.now() }
})

function setTimeToNow() {
  formTimeMs.value = Date.now()
}

function adjustValue(field: 'systolic' | 'diastolic', delta: number) {
  if (field === 'systolic') {
    formSystolic.value = Math.max(0, (formSystolic.value ?? 0) + delta)
  } else {
    formDiastolic.value = Math.max(0, (formDiastolic.value ?? 0) + delta)
  }
}

// ─── Clock ────────────────────────────────────────────────────────────────────

onMounted(() => {
  // Initialise Google API once both gapi and google.accounts are loaded
  const checkInterval = setInterval(() => {
    if (window.gapi && window.google) {
      clearInterval(checkInterval)
      initGoogleApi()
    }
  }, 100)

  // Reload local data after a Drive sync completes
  window.addEventListener('bpm_sync_complete', () => {
    loadTodayReadings()
  })

  const savedTheme = localStorage.getItem('bpm_theme')
  if (savedTheme === 'dark') isDarkMode.value = true

  loadTodayReadings()

  timer = window.setInterval(() => {
    now.value = new Date()
    loadTodayReadings()
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const timeParts = computed(() => {
  const s = now.value.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
  const parts = s.split(' ')
  return { time: parts[0], ampm: parts[1] }
})

const dateString = computed(() =>
  now.value.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
)

// ─── Colour palette ───────────────────────────────────────────────────────────

const cardColorClass = 'bg-gradient-to-br from-indigo-500 to-blue-600'

// ─── Latest reading (today) ───────────────────────────────────────────────────

const latestReading = computed(() => readings.value[0] ?? null)

// Whether we should show the "Log Now" pulse — always active until the first reading today
const isCardActive = computed(() => !latestReading.value)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ap}`
}

// ─── Modal actions ────────────────────────────────────────────────────────────

function openLogModal() {
  formTimeMs.value = Date.now()
  formSystolic.value = null
  formDiastolic.value = null
  formError.value = ''
  showLogModal.value = true
}

function saveLog() {
  formError.value = ''

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

  const entry: BpReading = {
    systolic: formSystolic.value,
    diastolic: formDiastolic.value,
    timestamp: formTimeMs.value,
  }

  // Prepend so newest reading is first
  readings.value = [entry, ...readings.value]
  persistReadings()
  showLogModal.value = false

  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.7 },
    colors: ['#6366f1', '#3b82f6', '#8b5cf6', '#06b6d4']
  })
}

// ─── Settings dropdown ────────────────────────────────────────────────────────

function toggleTheme() {
  isDarkMode.value = !isDarkMode.value
  localStorage.setItem('bpm_theme', isDarkMode.value ? 'dark' : 'light')
}

const dropdownOptions = computed(() => [
  { label: isDarkMode.value ? 'Light Mode' : 'Dark Mode', key: 'theme' },
  {
    label: !isSignedIn.value
      ? 'Connect Google Drive'
      : needsReauth.value
        ? 'Reconnect Google Drive'
        : (isSyncing.value ? 'Syncing to Drive...' : 'Sync Now'),
    key: 'sync',
    disabled: isSyncing.value
  },
  ...(isSignedIn.value ? [{ label: 'Disconnect Drive', key: 'signout' }] : [])
])

function handleDropdownSelect(key: string) {
  if (key === 'theme') toggleTheme()
  else if (key === 'sync') {
    if (!isSignedIn.value || needsReauth.value) handleAuthClick()
    else syncData()
  } else if (key === 'signout') {
    handleSignoutClick()
  }
}
</script>

<template>
  <n-config-provider :theme="isDarkMode ? darkTheme : null" :theme-overrides="themeOverrides">
    <div
      class="max-w-md mx-auto h-screen flex flex-col font-sans transition-colors duration-500 relative overflow-hidden"
      :class="isDarkMode ? 'bg-slate-950 text-slate-200' : 'bg-slate-50 text-slate-800'"
    >

      <!-- Header -->
      <div class="px-6 pt-10 pb-4 shrink-0 flex items-start justify-between z-20">
        <div>
          <div class="flex items-center gap-2 mb-0.5">
            <h1 class="font-bold tracking-widest uppercase text-[10px]" :class="isDarkMode ? 'text-slate-500' : 'text-slate-400'">
              BP Monitor
            </h1>
            <span v-if="isSignedIn" class="text-[9px] font-medium tracking-wide flex items-center gap-1">
              <template v-if="isSyncing">
                <svg class="animate-spin h-2.5 w-2.5" :class="isDarkMode ? 'text-slate-400' : 'text-slate-500'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span :class="isDarkMode ? 'text-slate-400' : 'text-slate-500'">SYNCING</span>
              </template>
              <template v-else-if="syncError">
                <button @click="needsReauth ? handleAuthClick() : syncData()" class="flex items-center gap-1 text-rose-500 dark:text-rose-400 hover:underline cursor-pointer" :title="syncError ?? ''">
                  <svg class="h-2.5 w-2.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{{ needsReauth ? 'RECONNECT DRIVE' : 'SYNC ERROR' }}</span>
                </button>
              </template>
              <template v-else>
                <svg class="h-2.5 w-2.5 text-emerald-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span :class="isDarkMode ? 'text-slate-500' : 'text-slate-400'">SYNCED</span>
              </template>
            </span>
          </div>
          <p class="text-sm font-semibold" :class="isDarkMode ? 'text-slate-300' : 'text-slate-600'">{{ dateString }}</p>
        </div>
        <n-dropdown :options="dropdownOptions" @select="handleDropdownSelect" placement="bottom-end" trigger="click">
          <button
            class="w-10 h-10 rounded-full flex items-center justify-center transition-colors shadow-sm shrink-0"
            :class="isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white text-slate-600 hover:bg-slate-100'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </button>
        </n-dropdown>
      </div>

      <!-- Clock -->
      <div class="px-6 pb-6 pt-2 shrink-0 flex flex-col items-center justify-center relative z-20">
        <div class="flex items-baseline">
          <span class="text-[72px] font-black tabular-nums tracking-tighter drop-shadow-sm leading-none" :class="isDarkMode ? 'text-white' : 'text-slate-800'">{{ timeParts.time }}</span>
          <span class="text-xl font-bold ml-2" :class="isDarkMode ? 'text-slate-500' : 'text-slate-400'">{{ timeParts.ampm }}</span>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex-1 min-h-0 w-full flex flex-col relative z-10 overflow-hidden">
        <n-tabs type="segment" justify-content="space-evenly" class="mb-2 flex flex-col h-full" pane-wrapper-style="flex: 1; min-height: 0;" pane-style="height: 100%;">

          <!-- Today tab -->
          <n-tab-pane name="today" tab="Today" display-directive="show">
            <div class="w-full h-full overflow-y-auto no-scrollbar px-4 pb-32 pt-2 flex flex-col gap-4 transition-colors duration-500">

              <!-- Log button — pinned at top -->
              <button
                @click="openLogModal"
                class="w-full py-4 rounded-2xl font-extrabold text-white text-sm uppercase tracking-widest shadow-lg active:scale-95 transition-all bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700"
              >
                + Log Blood Pressure
              </button>

              <!-- Empty state when no readings; card when there are readings -->
              <template v-if="readings.length === 0">
                <div class="flex flex-col items-center justify-center gap-3 py-16 px-4">
                  <div
                    class="w-16 h-16 rounded-full flex items-center justify-center"
                    :class="isDarkMode ? 'bg-slate-800' : 'bg-slate-100'"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8" :class="isDarkMode ? 'text-slate-500' : 'text-slate-400'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                  </div>
                  <p class="text-sm font-semibold" :class="isDarkMode ? 'text-slate-400' : 'text-slate-500'">No readings today</p>
                  <p class="text-xs text-center" :class="isDarkMode ? 'text-slate-600' : 'text-slate-400'">Tap the button above to log your first reading for today.</p>
                </div>
              </template>

              <template v-else>
                <div @click="openLogModal" class="cursor-pointer">
                  <BloodPressureCard
                    :color-class="cardColorClass"
                    :is-active="isCardActive"
                    :systolic="latestReading?.systolic"
                    :diastolic="latestReading?.diastolic"
                    :timestamp="latestReading?.timestamp"
                  />
                </div>
              </template>

              <!-- Today's readings list (all entries today, below the card) -->
              <div v-if="readings.length > 0" class="flex flex-col gap-2 mt-2">
                <h2 class="text-xs font-extrabold uppercase tracking-widest px-1" :class="isDarkMode ? 'text-slate-500' : 'text-slate-400'">
                  Today's Readings
                </h2>
                <n-card
                  v-for="(r, i) in readings"
                  :key="i"
                  class="w-full rounded-2xl shadow-sm border-0"
                  :class="isDarkMode ? 'bg-slate-800' : 'bg-white'"
                  :bordered="false"
                  size="small"
                >
                  <div class="flex justify-between items-center px-2 py-0.5">
                    <div class="flex items-center gap-2 text-xs font-semibold" :class="isDarkMode ? 'text-slate-400' : 'text-slate-500'">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {{ formatTime(r.timestamp) }}
                    </div>
                    <div class="flex items-end gap-1">
                      <span class="text-xl font-black tabular-nums" :class="isDarkMode ? 'text-slate-100' : 'text-slate-800'">{{ r.systolic }}</span>
                      <span class="font-black text-slate-400 mb-0.5">/</span>
                      <span class="text-lg font-black tabular-nums" :class="isDarkMode ? 'text-slate-300' : 'text-slate-600'">{{ r.diastolic }}</span>
                      <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-0.5 self-end">mmHg</span>
                    </div>
                  </div>
                </n-card>
              </div>

            </div>
          </n-tab-pane>

          <!-- History tab -->
          <n-tab-pane name="history" tab="History">
            <div class="w-full h-full overflow-y-auto no-scrollbar pb-32 transition-colors duration-500">
              <HistoryTab />
            </div>
          </n-tab-pane>

          <!-- Manage tab -->
          <n-tab-pane name="manage" tab="Manage">
            <div class="w-full h-full overflow-y-auto no-scrollbar pb-32 transition-colors duration-500">
              <ManageTab />
            </div>
          </n-tab-pane>

        </n-tabs>
      </div>

      <!-- Log Modal -->
      <n-modal v-model:show="showLogModal">
        <n-card
          style="width: 340px; border-radius: 28px;"
          title="Log Blood Pressure"
          :bordered="false"
          size="huge"
          role="dialog"
          aria-modal="true"
          class="shadow-2xl"
        >
          <div class="flex flex-col gap-6 pt-2">

            <!-- Time -->
            <div>
              <label class="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-2 block">Logged At</label>
              <div class="flex gap-2">
                <input
                  type="time"
                  v-model="formTimeString"
                  :style="{ colorScheme: isDarkMode ? 'dark' : 'light' }"
                  class="flex-1 min-w-0 rounded-2xl px-4 py-3.5 text-3xl font-black tabular-nums tracking-tight bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-4 focus:ring-indigo-500/30 transition-shadow"
                />
                <button
                  type="button"
                  @click="setTimeToNow"
                  class="shrink-0 px-4 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 active:scale-95 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs uppercase tracking-widest transition-all"
                >
                  Now
                </button>
              </div>
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
              <svg class="shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <span>{{ formError }}</span>
            </div>

          </div>

          <template #footer>
            <div class="flex items-center gap-3 mt-2 w-full justify-end">
              <n-button size="large" @click="showLogModal = false" class="font-bold">Cancel</n-button>
              <n-button type="primary" size="large" @click="saveLog" class="font-bold px-6 shadow-md">Save</n-button>
            </div>
          </template>
        </n-card>
      </n-modal>

    </div>
  </n-config-provider>
</template>

<style>
.n-tabs-nav { padding: 0 16px !important; }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
