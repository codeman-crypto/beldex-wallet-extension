# Beldex Wallet Extension

A Manifest V3 browser-extension wallet for Beldex (BDX), built on the same WASM crypto core
(`BeldexLibAppCpp_WASM`, from [`beldex-core-cpp`](https://github.com/Beldex-Coin/beldex-core-cpp))
used by [`beldex-lws-frontend`](https://github.com/Beldex-Coin/beldex-lws-frontend), consumed via
the `@bdxi/beldex-app-bridge` npm package.

## Architecture

```
popup (window context)                     background service worker
┌────────────────────────────┐             ┌───────────────────────────┐
│ React UI                   │  messages   │ Encrypted vault           │
│ WASM bridge (keys, tx      │◄───────────►│  PBKDF2 + AES-GCM         │
│ construction, signing)     │             │  chrome.storage.local     │
│ LWS client (fetch)         │             │ Session + auto-lock alarm │
└──────────┬─────────────────┘             └───────────────────────────┘
           │ view key only
           ▼
   Beldex LWS server  ──►  beldexd
   (scans chain with view key; spend keys never leave the popup)
```

- The WASM runs **only in the popup** — the Emscripten glue targets window contexts and MV3
  service workers are ephemeral anyway.
- The glue resolves the wasm at `/assets/BeldexLibAppCpp_WASM.wasm`; webpack copies it out of
  `node_modules` into `dist/assets/` so it loads from the extension origin (satisfies MV3's
  no-remote-code rule; CSP includes `wasm-unsafe-eval`).

## Setup

```bash
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `dist/`.

**Before first use:** set `LWS_URL` in `src/lib/config.ts` to a running Beldex light-wallet
server (the backend beldex-lws-frontend uses), and narrow `host_permissions` in
`public/manifest.json` to that host.

## What works / what's stubbed

| Area | Status |
|---|---|
| Create / restore wallet (25-word seed) | wired via WASM bridge |
| Encrypted vault, unlock/lock, auto-lock | implemented (PBKDF2 600k + AES-GCM) |
| Balance / sync status via LWS | wired, but **naive** — see below |
| Send (incl. flash priority 5) | wired via `async__send_funds`; **verify arg shape** against `@bdxi/beldex-sendfunds-utils` |
| Spent-output detection | **TODO** — compute key images client-side (`generateKeyImage`) and filter `spent_outputs`; see `@bdxi/beldex-keyimage-cache` |
| BNS name resolution | stub in `lws.ts` (`bns_resolve` via daemon JSON-RPC); record decryption TODO |
| Receive view / QR, subaddresses, fiat rates | not started |

## Must-verify before production

1. **Hard-fork currency of the WASM**: confirm the published `@bdxi/beldex-app-bridge` build
   constructs CLSAG + Bulletproofs+ transactions valid for current mainnet consensus
   (`BULLETPROOF_PLUS = hf20` in `beldex/src/ringct`). Test on testnet; rebuild
   `beldex-core-cpp` if stale.
2. **Send-funds callback shapes** in `src/lib/send.ts` — copied from the MyMonero v2 convention;
   diff against `beldex-lws-frontend`'s actual usage.
3. **KDF hardening**: consider argon2-browser instead of PBKDF2.
4. **Security review**: seed display flow, clipboard handling, phishing protection, and the
   privacy disclosure that the LWS sees your view key (it can see incoming funds, not spend).

## Trust model

Light-wallet architecture (MyMonero model): the server scans the chain with your **view key**.
It can observe incoming transactions but can never spend funds — spend keys exist only inside
the popup, encrypted at rest with your password.
