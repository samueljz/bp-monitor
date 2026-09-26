/// <reference types="gapi" />
/// <reference types="gapi.client.drive-v3" />
/// <reference types="google.accounts" />

import { ref } from 'vue'

const CLIENT_ID       = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const DISCOVERY_DOC   = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
const SCOPES          = 'https://www.googleapis.com/auth/drive.file'
const FILE_NAME       = 'BPMonitorBackup.json'
const TOKEN_KEY       = 'bpm_google_token'
const TOKEN_EXPIRY_KEY = 'bpm_token_expires_at'

export const isGapiLoaded = ref(false)
export const isSignedIn   = ref(false)
export const isSyncing    = ref(false)
export const syncError    = ref<string | null>(null)
// True once silent (popup-free) token renewal has actually failed, meaning
// the user must click through a visible Google consent prompt to continue.
export const needsReauth  = ref(false)

// ── Drive-conflict resolution ────────────────────────────────────────────────
// Instead of calling window.confirm (blocking, unstyled, mobile-unfriendly),
// we expose this reactive state. App.vue watches it and shows a proper modal.

export interface ConflictState {
  remoteData:  Record<string, unknown>
  localData:   Record<string, unknown>
  fileId:      string
  accessToken: string
  metadata:    { name: string; mimeType: string }
}

export const pendingConflict = ref<ConflictState | null>(null)

/** Called by App.vue after the user picks a conflict resolution strategy. */
export async function resolveConflict(prioritizeRemote: boolean) {
  const conflict = pendingConflict.value
  if (!conflict) return

  mergeData(conflict.remoteData, conflict.localData, prioritizeRemote)

  const mergedForm = new FormData()
  mergedForm.append('metadata', new Blob([JSON.stringify(conflict.metadata)], { type: 'application/json' }))
  mergedForm.append('file',     new Blob([JSON.stringify(conflict.localData)], { type: 'application/json' }))

  isSyncing.value = true
  try {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${conflict.fileId}?uploadType=multipart`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${conflict.accessToken}` }, body: mergedForm },
    )
    if (!res.ok) throw new Error(`Patch failed: ${res.status}`)
    syncError.value = null
  } catch (err: unknown) {
    syncError.value = err instanceof Error ? err.message : 'Sync failed'
  } finally {
    isSyncing.value     = false
    pendingConflict.value = null
  }
}

// ── Token management ─────────────────────────────────────────────────────────

let tokenClient: google.accounts.oauth2.TokenClient | null = null
let pendingRefreshPromise: Promise<boolean> | null = null
let refreshLoopHandle: number | null = null
let oauthState: string = crypto.randomUUID()

// Mutable callback used by initTokenClient — swapped before each
// requestAccessToken call so different call sites can handle the response
// differently without re-creating the client.
let activeTokenCallback: ((r: google.accounts.oauth2.TokenResponse) => void) | null = null

// Proactively renew the token well before it expires so a real sync call
// never has to block on a just-in-time silent refresh.
const PROACTIVE_REFRESH_WINDOW_MS = 5 * 60 * 1000
const REFRESH_LOOP_INTERVAL_MS    = 60 * 1000

function saveTokenResponse(tokenResponse: google.accounts.oauth2.TokenResponse) {
  const expiresInSeconds = Number(tokenResponse.expires_in) || 3600
  // Subtract 120 s as a safety margin
  const expiresAt = Date.now() + Math.max(expiresInSeconds - 120, 60) * 1000

  localStorage.setItem(TOKEN_KEY,        JSON.stringify(tokenResponse))
  localStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt.toString())

  if (window.gapi && gapi.client) {
    // GIS TokenResponse is structurally compatible with gapi's setToken input;
    // cast through any for this known cross-library surface mismatch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gapi.client.setToken(tokenResponse as any)
  }

  needsReauth.value = false
}

export function isTokenExpired(): boolean {
  const expiresAt = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) || 0)
  return !expiresAt || Date.now() >= expiresAt
}

function isTokenExpiringSoon(): boolean {
  const expiresAt = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) || 0)
  return !expiresAt || expiresAt - Date.now() <= PROACTIVE_REFRESH_WINDOW_MS
}

export async function ensureValidToken(): Promise<boolean> {
  // Memory token still valid — nothing to do
  if (!isTokenExpired() && window.gapi && gapi.client && gapi.client.getToken()?.access_token) {
    return true
  }

  // Persisted token still valid — rehydrate into gapi
  if (!isTokenExpired()) {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as google.accounts.oauth2.TokenResponse
        if (parsed?.access_token && window.gapi && gapi.client) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          gapi.client.setToken(parsed as any)
          return true
        }
      } catch {
        // Fall through to silent refresh
      }
    }
  }

  // A silent refresh is already in flight — wait for it
  if (pendingRefreshPromise) return pendingRefreshPromise

  if (!tokenClient) return false

  // Request a new token silently. Google grants this without a visible prompt
  // as long as the user still has an active session and previously consented;
  // it fails only when that is no longer true.
  pendingRefreshPromise = new Promise<boolean>((resolve) => {
    let resolved = false

    const finish = (ok: boolean) => {
      if (resolved) return
      resolved = true
      pendingRefreshPromise = null
      if (!ok) needsReauth.value = true
      resolve(ok)
    }

    const timeout = setTimeout(() => finish(false), 5000)

    try {
      // Set the per-call handler before triggering the request
      activeTokenCallback = (response: google.accounts.oauth2.TokenResponse) => {
        clearTimeout(timeout)
        if (response && !response.error) {
          saveTokenResponse(response)
          isSignedIn.value = true
          finish(true)
        } else {
          console.warn('Silent token refresh failed:', response?.error)
          finish(false)
        }
      }
      tokenClient!.requestAccessToken({ prompt: '', state: oauthState })
    } catch (err) {
      clearTimeout(timeout)
      finish(false)
    }
  })

  return pendingRefreshPromise
}

// Keep the token fresh in the background so an interactive sync rarely has
// to wait on (or risk failing) a just-in-time silent refresh.
function startProactiveRefreshLoop() {
  if (refreshLoopHandle !== null) return
  refreshLoopHandle = window.setInterval(() => {
    if (!isSignedIn.value || needsReauth.value) return
    if (isTokenExpiringSoon()) ensureValidToken()
  }, REFRESH_LOOP_INTERVAL_MS)
}

// ── Initialisation ───────────────────────────────────────────────────────────

export function initGoogleApi() {
  if (!CLIENT_ID) return

  // Load Google Identity Services
  if (window.google) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      // Delegate to the mutable `activeTokenCallback` so different call sites
      // (login flow vs. silent refresh) can each supply their own handler.
      callback: (tokenResponse: google.accounts.oauth2.TokenResponse) => {
        activeTokenCallback?.(tokenResponse)
      },
    })
  }

  // Load gapi client
  if (window.gapi) {
    gapi.load('client', async () => {
      await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] })
      isGapiLoaded.value = true

      const savedToken = localStorage.getItem(TOKEN_KEY)
      if (savedToken) {
        isSignedIn.value = true
        const valid = await ensureValidToken()
        if (valid) syncData()
      }

      startProactiveRefreshLoop()
    })
  }
}

// ── Auth actions ─────────────────────────────────────────────────────────────

export function handleAuthClick() {
  if (!tokenClient) {
    alert('Google Client ID is missing! Please configure VITE_GOOGLE_CLIENT_ID in your .env file.')
    return
  }
  syncError.value = null
  const currentToken = window.gapi?.client?.getToken()

  // Install the login flow callback before triggering the token request
  activeTokenCallback = (tokenResponse: google.accounts.oauth2.TokenResponse) => {
    if (tokenResponse.error !== undefined) {
      console.error('Auth error:', tokenResponse.error)
      return
    }
    // Validate state to prevent CSRF attacks — always enforced
    if (tokenResponse.state !== oauthState) {
      console.error('OAuth state mismatch — possible CSRF attack, ignoring response')
      return
    }
    // Rotate state after each successful response
    oauthState = crypto.randomUUID()
    saveTokenResponse(tokenResponse)
    isSignedIn.value = true
    syncData(true) // Automatically sync on login; may prompt conflict resolution
  }

  // Only show the visible Google consent screen once silent renewal has
  // actually failed (or we've never authenticated). Otherwise try silently
  // first so the user isn't interrupted for a routine expiry.
  if (!currentToken || needsReauth.value) {
    tokenClient.requestAccessToken({ prompt: 'consent', state: oauthState })
  } else {
    tokenClient.requestAccessToken({ prompt: '', state: oauthState })
  }
}

export function handleSignoutClick() {
  const token = window.gapi?.client?.getToken()

  const clearSession = () => {
    if (window.gapi?.client) gapi.client.setToken(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_EXPIRY_KEY)
    isSignedIn.value  = false
    syncError.value   = null
    needsReauth.value = false
  }

  if (token?.access_token && typeof google?.accounts?.oauth2?.revoke === 'function') {
    google.accounts.oauth2.revoke(token.access_token, clearSession)
  } else {
    clearSession()
  }
}

// ── Drive helpers ────────────────────────────────────────────────────────────

async function findBackupFile(): Promise<string | null> {
  const response = await gapi.client.drive.files.list({
    q: `name='${FILE_NAME}' and trashed=false`,
    spaces: 'drive',
    fields: 'files(id, name)',
  })
  const files = response.result.files
  return files && files.length > 0 ? (files[0]?.id ?? null) : null
}

async function downloadFile(fileId: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await gapi.client.drive.files.get({ fileId, alt: 'media' })
    if (typeof response.result === 'string') return JSON.parse(response.result)
    return (response.result as Record<string, unknown>) ?? null
  } catch (err) {
    console.error('Failed to download or parse remote backup', err)
    return null
  }
}

function mergeData(
  remote: Record<string, unknown>,
  local:  Record<string, unknown>,
  prioritizeRemote: boolean,
) {
  for (const key of Object.keys(remote)) {
    if (key.startsWith('bpm_') && key !== TOKEN_KEY && key !== TOKEN_EXPIRY_KEY) {
      if (prioritizeRemote || !(key in local)) {
        const val = typeof remote[key] === 'object'
          ? JSON.stringify(remote[key])
          : remote[key]
        localStorage.setItem(key, val as string)
        local[key] = remote[key]
      }
    }
  }
  window.dispatchEvent(new CustomEvent('bpm_sync_complete'))
}

// ── Sync ─────────────────────────────────────────────────────────────────────

let syncTimeout: number | null = null

/**
 * Debounced sync to Google Drive.
 *
 * @param promptUser When true and the remote file already exists, the reactive
 *                   `pendingConflict` is populated instead of auto-merging,
 *                   allowing the UI to present a proper conflict-resolution
 *                   modal rather than blocking with `window.confirm`.
 */
export function syncData(promptUser = false) {
  if (syncTimeout) window.clearTimeout(syncTimeout)

  syncTimeout = window.setTimeout(async () => {
    if (!isSignedIn.value) return

    const tokenValid = await ensureValidToken()
    if (!tokenValid) {
      console.warn('Cannot sync: token expired or unavailable.')
      syncError.value = 'Auth session expired'
      return
    }

    isSyncing.value = true
    syncError.value = null

    try {
      const fileId       = await findBackupFile()
      const currentToken = gapi.client.getToken()?.access_token
      if (!currentToken) throw new Error('Missing access token')

      // Gather all bpm_-prefixed keys, excluding auth credentials
      const appData: Record<string, unknown> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('bpm_') && key !== TOKEN_KEY && key !== TOKEN_EXPIRY_KEY) {
          try {
            appData[key] = JSON.parse(localStorage.getItem(key) || 'null')
          } catch {
            appData[key] = localStorage.getItem(key)
          }
        }
      }

      const metadata = { name: FILE_NAME, mimeType: 'application/json' }

      if (fileId) {
        const remoteData = await downloadFile(fileId)
        if (remoteData) {
          if (promptUser) {
            // Defer to the UI — App.vue will display a conflict-resolution modal
            isSyncing.value = false
            pendingConflict.value = { remoteData, localData: appData, fileId, accessToken: currentToken, metadata }
            return
          }

          // Auto-merge: local data wins
          mergeData(remoteData, appData, false)

          const mergedForm = new FormData()
          mergedForm.append('metadata', new Blob([JSON.stringify(metadata)],   { type: 'application/json' }))
          mergedForm.append('file',     new Blob([JSON.stringify(appData)],    { type: 'application/json' }))

          const patchRes = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`,
            { method: 'PATCH', headers: { Authorization: `Bearer ${currentToken}` }, body: mergedForm },
          )
          if (!patchRes.ok) throw new Error(`Patch failed: ${patchRes.status}`)
        }
      } else {
        // No remote file yet — create it
        const form = new FormData()
        form.append('metadata', new Blob([JSON.stringify(metadata)],              { type: 'application/json' }))
        form.append('file',     new Blob([JSON.stringify(appData)],               { type: 'application/json' }))

        const postRes = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          { method: 'POST', headers: { Authorization: `Bearer ${currentToken}` }, body: form },
        )
        if (!postRes.ok) throw new Error(`Create failed: ${postRes.status}`)
      }

      syncError.value = null
    } catch (err: unknown) {
      console.error('Sync failed', err)
      const message = err instanceof Error ? err.message : 'Sync failed'
      syncError.value = message
      if ((err as { status?: number })?.status === 401 || message.includes('401')) {
        handleSignoutClick()
      }
    } finally {
      isSyncing.value = false
    }
  }, 1000)
}
