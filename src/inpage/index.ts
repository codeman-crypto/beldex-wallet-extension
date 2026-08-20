// Injected into the page's MAIN world by the content script. Defines the
// frozen window.beldex provider and answers the beldex:requestProvider /
// beldex:announceProvider discovery handshake (PROTOCOL.md §2).
//
// This script has NO chrome.* access and holds NO secrets — it only relays
// envelopes to the content script via window.postMessage. Treat everything
// here as running in hostile territory: the page can see (and mess with)
// anything in this file, which is why the provider is frozen and all trust
// decisions live in the background.

import {
  ANNOUNCE_PROVIDER_EVENT, DAPP_EVENTS, REQUEST_PROVIDER_EVENT,
  REQUEST_TARGET, RESPONSE_TARGET
} from '../lib/dappProtocol'
import type { DappEvent, DappMethod } from '../lib/dappProtocol'

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: { code: number; message: string }) => void
}

const pending = new Map<string, Pending>()
const listeners = new Map<string, Set<(data: unknown) => void>>()
const EVENTS: ReadonlySet<string> = new Set(DAPP_EVENTS)

/**
 * Request id. NOT crypto.randomUUID(): this file runs in the PAGE's context,
 * and randomUUID is a secure-context-only API — on a plain http:// page (an
 * explorer or dapp served over http from anything other than localhost) it is
 * undefined, and calling it here would throw at document_start, taking
 * window.beldex and the announce with it. getRandomValues has no such
 * restriction. Ids are correlation handles, never secrets.
 */
function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6]! & 0x0f) | 0x40 // version 4
  b[8] = (b[8]! & 0x3f) | 0x80 // variant 1
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

window.addEventListener('message', ev => {
  if (ev.source !== window) return
  const msg = ev.data
  if (typeof msg !== 'object' || msg === null) return
  if ((msg as { target?: unknown }).target !== RESPONSE_TARGET) return

  const evName = (msg as { event?: unknown }).event
  if (typeof evName === 'string') {
    if (!EVENTS.has(evName)) return
    for (const fn of listeners.get(evName) ?? []) {
      try { fn((msg as { data?: unknown }).data) } catch { /* page listener error */ }
    }
    return
  }

  const id = (msg as { id?: unknown }).id
  if (typeof id !== 'string') return
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  const error = (msg as { error?: unknown }).error
  if (error !== undefined) {
    const e = error as { code?: unknown; message?: unknown }
    if (typeof e?.code !== 'number' || typeof e?.message !== 'string') {
      p.reject({ code: -32603, message: 'malformed wallet response' })
      return
    }
    p.reject({ code: e.code, message: e.message })
    return
  }
  p.resolve((msg as { result?: unknown }).result)
})

const provider = Object.freeze({
  isBeldex: true as const,
  request(args: { method: DappMethod; params?: object }): Promise<unknown> {
    const method = args?.method
    const id = uuid()
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      window.postMessage(
        { target: REQUEST_TARGET, id, method, ...(args?.params !== undefined ? { params: args.params } : {}) },
        '*'
      )
    })
  },
  on(event: DappEvent, listener: (data: unknown) => void): void {
    let s = listeners.get(event)
    if (!s) listeners.set(event, (s = new Set()))
    s.add(listener)
  },
  off(event: DappEvent, listener: (data: unknown) => void): void {
    listeners.get(event)?.delete(listener)
  }
})

// Brand-green diamond mark (data URI so the announce payload is self-contained).
const ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" transform="rotate(45 12 12)" fill="%233EC745"/></svg>'
      .replace('%23', '#')
  )

const announce = () => {
  window.dispatchEvent(new CustomEvent(ANNOUNCE_PROVIDER_EVENT, {
    detail: Object.freeze({
      info: Object.freeze({
        uuid: uuid(), // per page-load, for de-duplication only
        name: 'Beldex Wallet',
        icon: ICON,
        rdns: 'io.beldex.wallet'
      }),
      provider
    })
  }))
}

// Install the provider BEFORE announcing. Discovery is best-effort; the
// window.beldex fallback (spec §2) must not be collateral damage if building or
// dispatching the announce payload ever throws.
// Compatibility fallback — never clobber another wallet (spec §2).
if ((window as { beldex?: unknown }).beldex === undefined) {
  try {
    Object.defineProperty(window, 'beldex', { value: provider, writable: false, configurable: false })
  } catch {
    ;(window as { beldex?: unknown }).beldex = provider
  }
}

window.addEventListener(REQUEST_PROVIDER_EVENT, () => { try { announce() } catch { /* page's loss */ } })
try { announce() } catch { /* provider is still on window */ }
