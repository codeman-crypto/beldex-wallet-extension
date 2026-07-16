// Background service worker: owns the encrypted wallet vaults, the unlocked
// session, and background chain-sync.
//
// Multi-wallet model: each wallet = { name, address, vault } under its own id;
// vaults are encrypted independently (each with its own password). Exactly one
// wallet is "active"; the session (chrome.storage.session — memory-backed,
// never on disk, survives SW restarts, cleared on browser exit) holds the
// active wallet's decrypted secrets while unlocked.
//
// No WASM here — the Emscripten glue targets window contexts; all crypto-core
// work happens in the panel.

import { encryptVault, decryptVault, Vault } from '../lib/keyring'
import { CONFIG } from '../lib/config'
import * as lws from '../lib/lws'
import type { BgRequest, BgResponse, WalletMeta, WalletSecrets, WalletState } from '../lib/messages'
import { wireToolbarOpensPanel } from '../lib/platform'
import { sessionStore } from '../lib/sessionStore'

// Open the panel when the toolbar icon is clicked (Chrome side panel / Firefox sidebar).
wireToolbarOpensPanel()

const LEGACY_VAULT_KEY = 'beldex_vault'
const WALLETS_KEY = 'wallets'
const ACTIVE_KEY = 'active_wallet_id'
const SESSION_KEY = 'session_secrets'
const CACHE_KEY = 'sync_cache'
const ALARM_LOCK = 'auto_lock'
const ALARM_SYNC = 'bg_sync'
const ATOMIC = 1e9

interface StoredWallet { name: string; address: string; vault: Vault }
type WalletMap = Record<string, StoredWallet>

// ---- wallet store (with one-time migration from the single-vault format) ----

async function getWallets(): Promise<WalletMap> {
  const o = await chrome.storage.local.get([WALLETS_KEY, LEGACY_VAULT_KEY, ACTIVE_KEY])
  let wallets: WalletMap = o[WALLETS_KEY] ?? {}
  if (Object.keys(wallets).length === 0 && o[LEGACY_VAULT_KEY]) {
    // migrate the pre-multi-wallet vault; address backfilled on first unlock
    wallets = { w1: { name: 'Wallet 1', address: '', vault: o[LEGACY_VAULT_KEY] } }
    await chrome.storage.local.set({ [WALLETS_KEY]: wallets, [ACTIVE_KEY]: 'w1' })
    await chrome.storage.local.remove(LEGACY_VAULT_KEY)
  }
  return wallets
}

async function setWallets(w: WalletMap): Promise<void> {
  await chrome.storage.local.set({ [WALLETS_KEY]: w })
}

async function getActiveId(): Promise<string | null> {
  const wallets = await getWallets()
  const ids = Object.keys(wallets)
  if (ids.length === 0) return null
  const o = await chrome.storage.local.get(ACTIVE_KEY)
  const id = o[ACTIVE_KEY]
  if (id && wallets[id]) return id
  await chrome.storage.local.set({ [ACTIVE_KEY]: ids[0] })
  return ids[0]
}

async function walletList(): Promise<WalletMeta[]> {
  const wallets = await getWallets()
  const active = await getActiveId()
  return Object.entries(wallets).map(([id, w]) => ({
    id, name: w.name, address: w.address, active: id === active
  }))
}

// ---- session ----------------------------------------------------------------

interface Session { walletId: string; secrets: WalletSecrets }

async function getSession(): Promise<Session | null> {
  const o = await sessionStore.get(SESSION_KEY)
  return o[SESSION_KEY] ?? null
}

async function startSession(walletId: string, secrets: WalletSecrets): Promise<void> {
  await sessionStore.set({ [SESSION_KEY]: { walletId, secrets } })
  await touchAutoLock()
  chrome.alarms.create(ALARM_SYNC, { periodInMinutes: 0.5, delayInMinutes: 0 })
}

async function endSession(): Promise<void> {
  await sessionStore.remove([SESSION_KEY, CACHE_KEY])
  await chrome.alarms.clear(ALARM_SYNC)
  await chrome.alarms.clear(ALARM_LOCK)
}

// ---- brute-force backoff --------------------------------------------------------
//
// Persisted in storage.session so it survives the service worker idling out
// (~30s) — otherwise an attacker could reset the counter just by waiting for the
// SW to unload. Still cleared on browser exit (session storage), which is fine.
// The real defense remains the PBKDF2-600k KDF; this is friction against rapid
// scripted guessing through the message channel.

interface BackoffEntry { fails: number; nextAllowedAt: number }
const BACKOFF_KEY = 'backoff_state'
const BACKOFF_THRESHOLD = 5
const BACKOFF_CAP_MS = 60_000

async function getBackoff(): Promise<Record<string, BackoffEntry>> {
  return ((await sessionStore.get(BACKOFF_KEY))[BACKOFF_KEY] as Record<string, BackoffEntry>) ?? {}
}

/** Returns an error message if this wallet is still in backoff, else null. */
async function backoffCheck(walletId: string): Promise<string | null> {
  const e = (await getBackoff())[walletId]
  if (e && Date.now() < e.nextAllowedAt) {
    const secs = Math.ceil((e.nextAllowedAt - Date.now()) / 1000)
    return `Too many attempts — try again in ${secs}s`
  }
  return null
}

async function backoffRecordFailure(walletId: string): Promise<void> {
  const state = await getBackoff()
  const e = state[walletId] ?? { fails: 0, nextAllowedAt: 0 }
  e.fails++
  if (e.fails >= BACKOFF_THRESHOLD) {
    // 5th failure -> 2s, then 4s, 8s, ... capped at 60s
    const delay = Math.min(2 ** (e.fails - BACKOFF_THRESHOLD + 1) * 1000, BACKOFF_CAP_MS)
    e.nextAllowedAt = Date.now() + delay
  }
  state[walletId] = e
  await sessionStore.set({ [BACKOFF_KEY]: state })
}

async function backoffReset(walletId: string): Promise<void> {
  const state = await getBackoff()
  if (walletId in state) {
    delete state[walletId]
    await sessionStore.set({ [BACKOFF_KEY]: state })
  }
}

// ---- auto-lock ----------------------------------------------------------------

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
  const session = await getSession()
  if (!session) { chrome.alarms.clear(ALARM_SYNC); return }
  const s = session.secrets
  try {
    const info = await lws.getAddressInfo({ address: s.address, view_key: s.secViewKey })
    const prevCache = (await sessionStore.get(CACHE_KEY))[CACHE_KEY]
    await sessionStore.set({ [CACHE_KEY]: { info, at: Date.now(), address: s.address } })

    // Notify on new incoming funds. Heuristic: total_received also grows from
    // change returned by our own outgoing txs, so skip when total_sent grew too.
    // Compare only caches for the same wallet (switching wallets resets this).
    if (prevCache?.address !== s.address) return
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

// ---- message handling ----------------------------------------------------------

async function stateResponse(): Promise<BgResponse> {
  const wallets = await walletList()
  const session = await getSession()
  const activeId = await getActiveId()
  const active = wallets.find(w => w.active)
  let state: WalletState = 'uninitialized'
  if (session && session.walletId === activeId) state = 'unlocked'
  else if (wallets.length > 0) state = 'locked'
  return {
    ok: true,
    state,
    address: state === 'unlocked' ? session!.secrets.address : undefined,
    walletName: active?.name,
    wallets
  }
}

async function handle(req: BgRequest): Promise<BgResponse> {
  switch (req.type) {
    case 'GET_STATE':
      return stateResponse()

    case 'SAVE_WALLET': {
      const wallets = await getWallets()
      // Reject a restore/create of an address already present, so re-importing the
      // same seed doesn't create duplicate entries (App.tsx keys wallets by address).
      if (Object.values(wallets).some(w => w.address && w.address === req.secrets.address)) {
        return { ok: false, error: 'This wallet is already imported' }
      }
      const vault = await encryptVault(JSON.stringify(req.secrets), req.password)
      const id = crypto.randomUUID()
      const name = req.name?.trim() || `Wallet ${Object.keys(wallets).length + 1}`
      wallets[id] = { name, address: req.secrets.address, vault }
      await setWallets(wallets)
      await chrome.storage.local.set({ [ACTIVE_KEY]: id })
      await endSession() // drop any previous wallet's session/cache
      await startSession(id, req.secrets)
      return stateResponse()
    }

    case 'UNLOCK': {
      const wallets = await getWallets()
      const activeId = await getActiveId()
      if (!activeId) return { ok: false, error: 'No wallet stored' }
      const wait = await backoffCheck(activeId)
      if (wait) return { ok: false, error: wait }
      try {
        const secrets: WalletSecrets = JSON.parse(await decryptVault(wallets[activeId].vault, req.password))
        if (!wallets[activeId].address && secrets.address) {
          wallets[activeId].address = secrets.address // backfill migrated wallet
          await setWallets(wallets)
        }
        await backoffReset(activeId)
        await startSession(activeId, secrets)
        return stateResponse()
      } catch {
        await backoffRecordFailure(activeId)
        return { ok: false, error: 'Incorrect password' }
      }
    }

    case 'LOCK':
      await endSession()
      return stateResponse()

    case 'GET_SECRETS': {
      const session = await getSession()
      if (!session) return { ok: false, error: 'Locked' }
      await touchAutoLock()
      return { ok: true, secrets: session.secrets }
    }

    case 'REVEAL': {
      // Always re-verifies the password against the ACTIVE wallet's vault.
      const wallets = await getWallets()
      const activeId = await getActiveId()
      if (!activeId) return { ok: false, error: 'No wallet stored' }
      const wait = await backoffCheck(activeId)
      if (wait) return { ok: false, error: wait }
      try {
        const secrets: WalletSecrets = JSON.parse(await decryptVault(wallets[activeId].vault, req.password))
        await backoffReset(activeId)
        return { ok: true, secrets }
      } catch {
        await backoffRecordFailure(activeId)
        return { ok: false, error: 'Incorrect password' }
      }
    }

    case 'CHANGE_PASSWORD': {
      const wallets = await getWallets()
      const activeId = await getActiveId()
      if (!activeId) return { ok: false, error: 'No wallet stored' }
      // Same throttle as UNLOCK/REVEAL — without it this path is a free
      // password-guessing oracle that bypasses the backoff entirely.
      const wait = await backoffCheck(activeId)
      if (wait) return { ok: false, error: wait }
      let plaintext: string
      try {
        plaintext = await decryptVault(wallets[activeId].vault, req.oldPassword)
      } catch {
        await backoffRecordFailure(activeId)
        return { ok: false, error: 'Current password is incorrect' }
      }
      await backoffReset(activeId)
      wallets[activeId].vault = await encryptVault(plaintext, req.newPassword)
      await setWallets(wallets)
      return { ok: true }
    }

    case 'TOUCH': {
      // Panel user activity: keep the session alive while the wallet is in use.
      if (await getSession()) await touchAutoLock()
      return { ok: true }
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

    case 'SWITCH_WALLET': {
      const wallets = await getWallets()
      if (!wallets[req.id]) return { ok: false, error: 'Unknown wallet' }
      const activeId = await getActiveId()
      if (req.id !== activeId) {
        await endSession() // switching requires the target wallet's password
        await chrome.storage.local.set({ [ACTIVE_KEY]: req.id })
      }
      return stateResponse()
    }

    case 'RENAME_WALLET': {
      const wallets = await getWallets()
      const activeId = await getActiveId()
      if (!activeId) return { ok: false, error: 'No wallet stored' }
      const name = req.name.trim()
      if (!name) return { ok: false, error: 'Name cannot be empty' }
      wallets[activeId].name = name
      await setWallets(wallets)
      return stateResponse()
    }

    case 'WIPE': {
      // deletes the ACTIVE wallet only; other wallets stay intact
      const wallets = await getWallets()
      const activeId = await getActiveId()
      if (!activeId) return { ok: false, error: 'No wallet stored' }
      // Require the password so a walk-up attacker with an unlocked panel can't
      // delete the wallet from a UI-only confirmation. Throttled like UNLOCK.
      const wait = await backoffCheck(activeId)
      if (wait) return { ok: false, error: wait }
      try {
        await decryptVault(wallets[activeId].vault, req.password)
      } catch {
        await backoffRecordFailure(activeId)
        return { ok: false, error: 'Incorrect password' }
      }
      await backoffReset(activeId)
      delete wallets[activeId]
      await setWallets(wallets)
      const remaining = Object.keys(wallets)
      await chrome.storage.local.set({ [ACTIVE_KEY]: remaining[0] ?? '' })
      await endSession()
      return stateResponse()
    }
  }
}

chrome.runtime.onMessage.addListener((req: BgRequest, sender, sendResponse) => {
  // Defense in depth: only our own extension pages may talk to the keyring.
  if (sender.id !== chrome.runtime.id) return
  handle(req).then(sendResponse).catch((e: Error) => sendResponse({ ok: false, error: e.message }))
  return true // keep the channel open for the async response
})
