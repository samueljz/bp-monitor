<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { NCard, NEmpty } from 'naive-ui'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

import { loadAllReadings }            from '../composables/useReadings'
import { bpCategory, formatTime }     from '../utils/bp'
import type { BpReadingWithMeta }     from '../utils/bp'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

// ── Data ──────────────────────────────────────────────────────────────────────

const allReadings = ref<BpReadingWithMeta[]>([])

function loadData() {
  allReadings.value = loadAllReadings()
}

// ── Chart ─────────────────────────────────────────────────────────────────────

const chartData = computed(() => {
  const cutoff = Date.now() - 36 * 60 * 60 * 1000
  const graphReadings = allReadings.value
    .filter(r => r.timestamp >= cutoff)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)

  return {
    labels: graphReadings.map(r => {
      const d = new Date(r.timestamp)
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    }),
    datasets: [
      {
        label: 'Systolic (mmHg)',
        data: graphReadings.map(r => r.systolic),
        borderColor: '#dc2626',
        backgroundColor: 'rgba(220, 38, 38, 0.1)',
        borderWidth: 2,
        tension: 0.3,
        fill: false,
      },
      {
        label: 'Diastolic (mmHg)',
        data: graphReadings.map(r => r.diastolic),
        borderColor: '#f97316',
        backgroundColor: 'rgba(249, 115, 22, 0.1)',
        borderWidth: 2,
        tension: 0.3,
        fill: false,
      },
    ],
  }
})

const hasChartData = computed(() => (chartData.value.datasets[0]?.data.length ?? 0) > 0)

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend:  { display: true, position: 'top' as const },
    tooltip: { mode: 'index' as const, intersect: false },
  },
  scales: {
    y: { min: 40, max: 200, title: { display: true, text: 'mmHg' } },
  },
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  loadData()
  window.addEventListener('bpm_sync_complete', loadData)
})

onUnmounted(() => {
  window.removeEventListener('bpm_sync_complete', loadData)
})
</script>

<template>
  <div class="flex flex-col h-full overflow-y-auto no-scrollbar pb-32 px-4 transition-colors duration-500">

    <!-- Chart card -->
    <n-card class="w-full mb-6 rounded-3xl shadow-sm border-0" :bordered="false" size="small">
      <h3 class="text-lg font-bold mb-4 ml-2">Last 36 Hours</h3>
      <div v-if="hasChartData" class="h-56">
        <Line :data="chartData" :options="chartOptions" />
      </div>
      <n-empty v-else description="No readings yet" class="my-6" />
    </n-card>

    <h3 class="text-lg font-bold mb-4 ml-2">All Readings</h3>

    <n-empty v-if="allReadings.length === 0" description="No historical readings found" />

    <div v-else class="flex flex-col gap-3">
      <n-card
        v-for="reading in allReadings"
        :key="reading.timestamp"
        class="w-full rounded-2xl shadow-sm border-0 bg-white dark:bg-slate-800"
        :bordered="false"
        size="small"
      >
        <div class="flex justify-between items-center px-2 py-1">
          <div class="flex flex-col">
            <div class="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <span>{{ reading.dateKey }}</span>
              <span class="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600"></span>
              <span>{{ formatTime(reading.timestamp) }}</span>
            </div>
            <span
              class="text-[11px] font-extrabold uppercase tracking-widest mt-1"
              :class="bpCategory(reading.systolic, reading.diastolic).cls"
            >
              {{ bpCategory(reading.systolic, reading.diastolic).label }}
            </span>
          </div>

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
        </div>
      </n-card>
    </div>

  </div>
</template>
