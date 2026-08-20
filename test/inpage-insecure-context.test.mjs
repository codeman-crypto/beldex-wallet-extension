// Regression: the injected provider must survive an INSECURE-CONTEXT page.
//
// src/inpage/index.ts runs in the page's own JS context. `crypto.randomUUID()`
// is a secure-context-only API, so on a plain http:// page served from anything
// other than localhost it is simply not there. It used to be called while
// building the announce payload, at module scope — so on those pages the script
// threw at document_start and never reached the code that installs
// window.beldex. The page saw no wallet at all, and the only visible symptom
// was "no extension detected" plus a stray TypeError in the console.
//
// This test runs the real module with randomUUID removed and asserts the
// provider is installed and discoverable anyway.

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** The sources use webpack-style extensionless imports, which node's ESM
 *  resolver rejects. Copy the two files out with explicit specifiers so the
 *  REAL module can be imported and run, rather than a copy that could drift. */
function importableInpage() {
  const dir = mkdtempSync(join(tmpdir(), 'bdx-inpage-'))
  writeFileSync(join(dir, 'dappProtocol.ts'),
    readFileSync(join(here, '../src/lib/dappProtocol.ts'), 'utf8'))
  writeFileSync(join(dir, 'inpage.ts'),
    readFileSync(join(here, '../src/inpage/index.ts'), 'utf8')
      .replace("'../lib/dappProtocol'", "'./dappProtocol.ts'"))
  return pathToFileURL(join(dir, 'inpage.ts')).href
}

const listeners = {}
let dispatched = []

before(async () => {
  // Minimal DOM surface, no randomUUID — exactly what an http:// page offers.
  const win = {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn) },
    dispatchEvent: ev => { dispatched.push(ev); for (const fn of listeners[ev.type] || []) fn(ev); return true },
    postMessage: () => {}
  }
  win.window = win
  globalThis.window = win
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail }
  }
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: b => { for (let i = 0; i < b.length; i++) b[i] = (i * 7 + 3) & 0xff; return b } }
  })

  await import(importableInpage()) // side effects on import, as in the page
})

test('installs window.beldex without crypto.randomUUID', () => {
  assert.equal(typeof globalThis.window.beldex, 'object')
  assert.equal(globalThis.window.beldex.isBeldex, true)
  assert.equal(typeof globalThis.window.beldex.request, 'function')
})

test('answers the discovery handshake with a usable uuid', () => {
  dispatched = []
  globalThis.window.dispatchEvent(new globalThis.CustomEvent('beldex:requestProvider'))
  const announce = dispatched.find(e => e.type === 'beldex:announceProvider')
  assert.ok(announce, 'no beldex:announceProvider dispatched')
  const { info, provider } = announce.detail
  assert.equal(info.rdns, 'io.beldex.wallet')
  assert.match(info.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(provider.isBeldex, true)
})

test('request() generates ids without randomUUID', async () => {
  const sent = []
  globalThis.window.postMessage = msg => sent.push(msg)
  globalThis.window.beldex.request({ method: 'bdx_getState' }) // never settles here
  assert.equal(sent.length, 1)
  assert.equal(sent[0].target, 'beldex-contentscript')
  assert.equal(typeof sent[0].id, 'string')
  assert.ok(sent[0].id.length > 0)
})
