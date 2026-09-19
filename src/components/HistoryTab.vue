<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NCard, NEmpty, NSpin } from 'naive-ui'
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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

interface BpReading {
  systolic: number
  diastolic: number
  timestamp: number
  dateStr: string
}

const allReadings = ref<BpReading[]>([])

const chartData = ref({
  labels: [] as string[],
  datasets: [
    {
      label: 'Systolic (mmHg)',
      data: [] as number[],
      borderColor: '#dc2626',
      backgroundColor: 'rgba(220, 38, 38, 0.1)',
      borderWidth: 2,
      tension: 0.3,
      fill: false,
    },
    {
      label: 'Diastolic (mmHg)',
      data: [] as number[],
      borderColor: '#f97316',
      backgroundColor: 'rgba(249, 115, 22, 0.1)',
      borderWidth: 2,
      tension: 0.3,
      fill: false,
    },
  ],
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: true, position: 'top' as const },
    tooltip: { mode: 'index' as const, intersect: false },
  },
  scales: {
    y: { min: 40, max: 200, title: { display: true, text: 'mmHg' } },
  },
}

const isLoading = ref(true)

onMounted(() => {
  loadData()
})

function loadData() {
  isLoading.value = true

  const keys = Object.keys(localStorage).filter(k => k.startsWith('bpm_readings_'))
  keys.sort((a, b) => b.localeCompare(a))

  let readings: BpReading[] = []

  keys.forEach(key => {
    const dateStr = key.replace('bpm_readings_', '')
    try {
      const data: BpReading[] = JSON.parse(localStorage.getItem(key) || '[]')
      data.forEach(r => readings.push({ ...r, dateStr }))
    } catch (e) {
      console.error('Error parsing', key)
    }
  })

  readings.sort((a, b) => b.timestamp - a.timestamp)
  allReadings.value = readings

  // Chart: only readings from the last 36 hours, ascending
  const cutoff = Date.now() - 36 * 60 * 60 * 1000
  const graphReadings = [...readings]
    .filter(r => r.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp)

  chartData.value.labels = graphReadings.map(r => {
    const d = new Date(r.timestamp)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  chartData.value.datasets[0]!.data = graphReadings.map(r => r.systolic)
  chartData.value.datasets[1]!.data = graphReadings.map(r => r.diastolic)

  isLoading.value = false
}

function formatFriendlyTime(ts: number) {
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
</script>

<template>
  <div class="flex flex-col h-full overflow-y-auto no-scrollbar pb-32 px-4 transition-colors duration-500">
    <div v-if="isLoading" class="flex justify-center py-10">
      <n-spin size="large" />
    </div>

    <template v-else>
      <n-card class="w-full mb-6 rounded-3xl shadow-sm border-0" :bordered="false" size="small">
        <h3 class="text-lg font-bold mb-4 ml-2">Last 36 Hours</h3>
        <div v-if="chartData.datasets[0]?.data?.length" class="h-56">
          <Line :data="chartData" :options="chartOptions" />
        </div>
        <n-empty v-else description="No readings yet" class="my-6" />
      </n-card>

      <h3 class="text-lg font-bold mb-4 ml-2">All Readings</h3>

      <div v-if="allReadings.length === 0">
        <n-empty description="No historical readings found" />
      </div>

      <div v-else class="flex flex-col gap-3">
        <n-card
          v-for="(reading, i) in allReadings"
          :key="i"
          class="w-full rounded-2xl shadow-sm border-0 bg-white dark:bg-slate-800"
          :bordered="false"
          size="small"
        >
          <div class="flex justify-between items-center px-2 py-1">
            <div class="flex flex-col">
              <div class="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <span>{{ reading.dateStr }}</span>
                <span class="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                <span>{{ formatFriendlyTime(reading.timestamp) }}</span>
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
    </template>
  </div>
</template>
