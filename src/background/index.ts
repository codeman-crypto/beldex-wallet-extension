// Background service worker: owns the encrypted vault, the unlocked session,
// and background chain-sync.
//
// Session storage: chrome.storage.session (memory-backed, never written to
// disk, cleared on browser exit). A plain variable won't do — MV3 kills idle
// workers after ~30s, which would silently re-lock the wallet.
//
// Background sync: while unlocked, a chrome.alarms job polls the LWS every
// 30s (Chrome's minimum), caches the result for instant popup display, and
// fires a notification when new funds arrive.
//
// No WASM here — the Emscripten glue targets window contexts; all crypto-core
// work happens in the popup.

import { encryptVault, decryptVault, Vault } from '../lib/keyring'
import { CONFIG } from '../lib/config'
import * as lws from '../lib/lws'
import type { BgRequest, BgResponse, WalletSecrets, WalletState } from '../lib/messages'

// Open the side panel when the toolbar icon is clicked (Chrome 114+).
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => { /* older Chrome — icon does nothing; panel still openable via context menu */ })

const VAULT_KEY = 'beldex_vault'
const SESSION_KEY = 'session_secrets'
const CACHE_KEY = 'sync_cache'
const ALARM_LOCK = 'auto_lock'
const ALARM_SYNC = 'bg_sync'
const ATOMIC = 1e9

// ---- session ----------------------------------------------------------------

async function getSession(): Promise<WalletSecrets | null> {
  const o = await chrome.storage.session.get(SESSION_KEY)
  return o[SESSION_KEY] ?? null
}

async function startSession(secrets: WalletSecrets): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: secrets })
  await touchAutoLock()
  chrome.alarms.create(ALARM_SYNC, { periodInMinutes: 0.5, delayInMinutes: 0 })
}

async function endSession(): Promise<void> {
  await chrome.storage.session.remove([SESSION_KEY, CACHE_KEY])
  await chrome.alarms.clear(ALARM_SYNC)
  await chrome.alarms.clear(ALARM_LOCK)
}

const AUTOLOCK_KEY = 'auto_lock_minutes'

async function autoLockMinutes(): Promise<number> {
  const o = await chrome.storage.local.get(AUTOLOCK_KEY)
  const m = Number(o[AUTOLOCK_KEY])
  return Number.isFinite(m) && m >= 1 && m <= 240 ? m : CONFIG.AUTO_LOCK_MINUTES
}

async function touchAutoLock() {
  chrome.alarms.create(ALARM_LOCK, { delayInMinutes: await autoLockMinutes() })
}

// ---- background sync ----------------------------------------------------------

async function syncOnce(): Promise<void> {
  const s = await getSession()
  if (!s) { chrome.alarms.clear(ALARM_SYNC); return }
  try {
    const info = await lws.getAddressInfo({ address: s.address, view_key: s.secViewKey })
    const prevCache = (await chrome.storage.session.get(CACHE_KEY))[CACHE_KEY]
    await chrome.storage.session.set({ [CACHE_KEY]: { info, at: Date.now() } })

    // Notify on new incoming funds. Heuristic: total_received also grows from
    // change returned by our own outgoing txs, so skip when total_sent grew too.
    const prevReceived = Number(prevCache?.info?.total_received ?? NaN)
    const prevSent = Number(prevCache?.info?.total_sent ?? NaN)
    const nowReceived = Number(info.total_received ?? 0)
    const nowSent = Number(info.total_sent ?? 0)
    if (!Number.isNaN(prevReceived) && nowReceived > prevReceived && nowSent <= prevSent) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Beldex Wallet',
        message: `Received ${((nowReceived - prevReceived) / ATOMIC).toFixed(4)} BDX`
      })
    }
  } catch {
    // network/LWS hiccup — next alarm will retry
  }
}

chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === ALARM_LOCK) await endSession()
  if (a.name === ALARM_SYNC) await syncOnce()
})

// ---- vault / message handling ----------------------------------------------

async function getVault(): Promise<Vault | null> {
  const o = await chrome.storage.local.get(VAULT_KEY)
  return o[VAULT_KEY] ?? null
}

async function state(): Promise<{ state: WalletState; address?: string }> {
  const session = await getSession()
  if (session) return { state: 'unlocked', address: session.address }
  return { state: (await getVault()) ? 'locked' : 'uninitialized' }
}

async function handle(req: BgRequest): Promise<BgResponse> {
  switch (req.type) {
    case 'GET_STATE': {
      const s = await state()
      return { ok: true, ...s }
    }

    case 'SAVE_WALLET': {
      const vault = await encryptVault(JSON.stringify(req.secrets), req.password)
      await chrome.storage.local.set({ [VAULT_KEY]: vault })
      await startSession(req.secrets)
      return { ok: true, state: 'unlocked', address: req.secrets.address }
    }

    case 'UNLOCK': {
      const vault = await getVault()
      if (!vault) return { ok: false, error: 'No wallet stored' }
      try {
        const secrets: WalletSecrets = JSON.parse(await decryptVault(vault, req.password))
        await startSession(secrets)
        return { ok: true, state: 'unlocked', address: secrets.address }
      } catch {
        return { ok: false, error: 'Incorrect password' }
      }
    }

    case 'LOCK':
      await endSession()
      return { ok: true, state: 'locked' }

    case 'GET_SECRETS': {
      const session = await getSession()
      if (!session) return { ok: false, error: 'Locked' }
      await touchAutoLock()
      return { ok: true, secrets: session }
    }

    case 'GET_AUTOLOCK':
      return { ok: true, minutes: await autoLockMinutes() }

    case 'SET_AUTOLOCK': {
      const m = Number(req.minutes)
      if (!Number.isFinite(m) || m < 1 || m > 240) return { ok: false, error: 'Invalid duration' }
      await chrome.storage.local.set({ [AUTOLOCK_KEY]: m })
      if (await getSession()) await touchAutoLock() // re-arm with the new duration
      return { ok: true, minutes: m }
    }

    case 'REVEAL': {
      // Always re-verifies the password against the vault, even while unlocked —
      // viewing seed/keys must prove knowledge of the password.
      const vault = await getVault()
      if (!vault) return { ok: false, error: 'No wallet stored' }
      try {
        const secrets: WalletSecrets = JSON.parse(await decryptVault(vault, req.password))
        return { ok: true, secrets }
      } catch {
        return { ok: false, error: 'Incorrect password' }
      }
    }

    case 'CHANGE_PASSWORD': {
      const vault = await getVault()
      if (!vault) return { ok: false, error: 'No wallet stored' }
      let plaintext: string
      try {
        plaintext = await decryptVault(vault, req.oldPassword)
      } catch {
        return { ok: false, error: 'Current password is incorrect' }
      }
      const newVault = await encryptVault(plaintext, req.newPassword)
      await chrome.storage.local.set({ [VAULT_KEY]: newVault })
      return { ok: true }
    }

    case 'WIPE':
      await endSession()
      await chrome.storage.local.remove(VAULT_KEY)
      return { ok: true, state: 'uninitialized' }
  }
}

chrome.runtime.onMessage.addListener((req: BgRequest, sender, sendResponse) => {
  // Defense in depth: only our own extension pages may talk to the keyring.
  // (Web pages can't reach onMessage without externally_connectable, but be explicit.)
  if (sender.id !== chrome.runtime.id) return
  handle(req).then(sendResponse).catch((e: Error) => sendResponse({ ok: false, error: e.message }))
  return true // keep the channel open for the async response
})
