import { ref, computed } from 'vue'
import type { BpReading } from '../utils/bp'

/**
 * Manages all state and actions for the "Log Blood Pressure" modal.
 *
 * @param onSave - Callback invoked when the user saves. Receives the new/edited
 *                 reading and the index being edited (-1 means new entry).
 */
export function useLogModal(onSave: (entry: BpReading, editingIndex: number) => void) {
  const showModal    = ref(false)
  const editingIndex = ref(-1)
  const formTimeMs   = ref<number>(Date.now())
  const formSystolic  = ref<number | null>(null)
  const formDiastolic = ref<number | null>(null)
  const formError    = ref('')

  // ── Two-way computed so the template can bind a <input type="time"> ────────

  const formTimeString = computed<string>({
    get: () => {
      const d = new Date(formTimeMs.value)
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    },
    set: (val) => {
      if (!val) { formTimeMs.value = Date.now(); return }
      const [h = 0, m = 0] = val.split(':').map(Number)
      const d = new Date()
      d.setHours(h, m, 0, 0)
      formTimeMs.value = d.getTime()
    },
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

  // ── Open ──────────────────────────────────────────────────────────────────

  /** Open modal for a brand-new reading. */
  function open() {
    editingIndex.value  = -1
    formTimeMs.value    = Date.now()
    formSystolic.value  = null
    formDiastolic.value = null
    formError.value     = ''
    showModal.value     = true
  }

  /** Open modal pre-filled with an existing reading for in-place editing. */
  function openEdit(reading: BpReading, index: number) {
    editingIndex.value  = index
    formTimeMs.value    = reading.timestamp
    formSystolic.value  = reading.systolic
    formDiastolic.value = reading.diastolic
    formError.value     = ''
    showModal.value     = true
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  function save() {
    formError.value = ''

    if (!formSystolic.value || formSystolic.value <= 0) {
      formError.value = 'Please enter a valid systolic value.'; return
    }
    if (!formDiastolic.value || formDiastolic.value <= 0) {
      formError.value = 'Please enter a valid diastolic value.'; return
    }
    if (formDiastolic.value >= formSystolic.value) {
      formError.value = 'Diastolic must be lower than systolic.'; return
    }

    onSave(
      { systolic: formSystolic.value, diastolic: formDiastolic.value, timestamp: formTimeMs.value },
      editingIndex.value,
    )
    showModal.value = false
  }

  function close() {
    showModal.value = false
  }

  return {
    showModal, editingIndex, formTimeMs, formTimeString,
    formSystolic, formDiastolic, formError,
    open, openEdit, save, close, setTimeToNow, adjustValue,
  }
}
