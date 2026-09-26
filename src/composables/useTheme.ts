import { ref, computed, watch } from 'vue'
import { darkTheme } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * Manages dark/light mode state, persists the preference to localStorage,
 * and syncs the `dark` CSS class on <html>.
 */
export function useTheme() {
  const isDarkMode = ref(false)

  watch(isDarkMode, (val) => {
    if (val) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }, { immediate: true })

  /** Call once on app mount to restore the persisted theme. */
  function initTheme() {
    if (localStorage.getItem('bpm_theme') === 'dark') isDarkMode.value = true
  }

  function toggleTheme() {
    isDarkMode.value = !isDarkMode.value
    localStorage.setItem('bpm_theme', isDarkMode.value ? 'dark' : 'light')
  }

  const naiveTheme = computed(() => isDarkMode.value ? darkTheme : null)

  const themeOverrides: GlobalThemeOverrides = {
    common: {
      primaryColor: '#dc2626',
      primaryColorHover: '#ef4444',
      primaryColorPressed: '#b91c1c',
      borderRadius: '12px',
    },
    Card: { borderRadius: '24px', paddingMedium: '20px' },
    Button: { borderRadiusMedium: '10px' },
  }

  return { isDarkMode, naiveTheme, themeOverrides, initTheme, toggleTheme }
}
