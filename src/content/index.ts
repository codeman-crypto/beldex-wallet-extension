// Content script (isolated world): the only bridge between the page and the
// extension. Relays exact-shape request envelopes (page → background Port) and
// response/event messages (background Port → page). Anything malformed is
// silently dropped (PROTOCOL.md §1). No secrets ever transit this file.
//
// The inpage provider (inpage.js) is injected by the MANIFEST with
// "world": "MAIN" at document_start — guaranteed to run before any page
// script, unlike a <script src> tag which loads asynchronously and loses the
// race against inline page scripts. Requires Chrome 111+ / Firefox 128+.

import { parseDappRequest, PORT_NAME, RESPONSE_TARGET } from '../lib/dappProtocol'
import type { DappPortMessage } from '../lib/dappProtocol'

// ---- relay -----------------------------------------------------------------

let port: chrome.runtime.Port | null = null
/** Request ids forwarded but not yet answered — failed with INTERNAL if the
 *  port dies (background service worker restarted / extension updated). */
const inflight = new Set<string>()

function replyToPage(msg: object): void {
  window.postMessage({ target: RESPONSE_TARGET, ...msg }, '*')
}

function failInflight(reason: string): void {
  for (const id of inflight) {
    replyToPage({ id, error: { code: -32603, message: reason } })
  }
  inflight.clear()
}

function ensurePort(): chrome.runtime.Port | null {
  if (port) return port
  try {
    port = chrome.runtime.connect({ name: PORT_NAME })
  } catch {
    return null // extension unloaded/updating
  }
  port.onMessage.addListener((msg: DappPortMessage) => {
    if (typeof msg !== 'object' || msg === null) return
    if ('event' in msg && typeof msg.event === 'string') {
      replyToPage({ event: msg.event, ...('data' in msg && msg.data !== undefined ? { data: msg.data } : {}) })
      return
    }
    if ('id' in msg && typeof msg.id === 'string') {
      inflight.delete(msg.id)
      const out: Record<string, unknown> = { id: msg.id }
      if ('error' in msg && msg.error !== undefined) out.error = msg.error
      else out.result = 'result' in msg ? msg.result : undefined
      replyToPage(out)
    }
  })
  port.onDisconnect.addListener(() => {
    port = null
    failInflight('wallet unavailable — retry')
    // Reconnect eagerly so event pushes (balanceChanged, lock, …) resume
    // after a service-worker restart. Small delay avoids a tight loop while
    // the browser reloads the extension.
    setTimeout(() => { ensurePort() }, 250)
  })
  return port
}

window.addEventListener('message', ev => {
  if (ev.source !== window) return
  const req = parseDappRequest(ev.data)
  if (!req) return
  const p = ensurePort()
  if (!p) {
    replyToPage({ id: req.id, error: { code: -32603, message: 'wallet extension unavailable' } })
    return
  }
  inflight.add(req.id)
  try {
    p.postMessage(req)
  } catch {
    inflight.delete(req.id)
    replyToPage({ id: req.id, error: { code: -32603, message: 'wallet extension unavailable' } })
  }
})

// Connect at load so this origin receives event pushes without needing a
// request first (harmless if the page never uses the wallet — the background
// only pushes events to origins holding a grant).
ensurePort()
