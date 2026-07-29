# HANDOFF — Beldex Wallet Browser Extension

**Last updated:** 2026-07-15
**Repo state:** `main`, all work committed (author: `Codeman Crypto <codeman.crypto@beldex.io>`), ahead of `origin/main` — push pending.
**Builds:** `dist/` (Chrome MV3) and `firefox/` (Firefox MV3) both compile clean; `npm test` 6/6; `web-ext lint` 0 errors.

---

## 1. What this is

A non-custodial MV3 browser-extension light wallet for Beldex (BDX), built on the
same WASM crypto core as the official `beldex-lws-frontend` web wallet. Runs as a
**side panel** (Chrome) / **sidebar** (Firefox), with an optional full-screen tab
mode. Spend keys never leave the panel page; chain scanning is delegated to the
Beldex light-wallet server (LWS) which holds only the **view key**.

### Stack

- **Crypto core:** `@bdxi/beldex-app-bridge` v3.0.0 (npm) — Emscripten WASM build
  of `beldex-core-cpp` (MyMonero-lineage). Handles wallet gen/restore (25-word
  Electrum seed), address decode, key images, integrated addresses, and full
  transaction construction/signing (CLSAG + Bulletproofs+) via `async__send_funds`.
- **UI:** React 18 + TypeScript, webpack 5, no CSS framework (design system in
  `public/panel.html` — beldex.io look: black dot-grid, Michroma + Space Mono
  bundled via @fontsource, sharp white buttons, brand green `#3EC745`).
- **Backend endpoints** (see `src/lib/config.ts`):
  - LWS: `https://lwsapi.beldex.io` — `/login /get_address_info /get_address_txs
    /get_unspent_outs /get_random_outs /submit_raw_tx` (spec:
    `beldex/src/wallet/wallet_light_rpc.h` in the core repo)
  - BNS resolution: `https://explorer.beldex.io/api/bnslookup?name=<name>`
  - Price: CoinGecko `simple/price?ids=beldex` (60s cache)

---

## 2. Architecture

```
panel.html (side panel / sidebar / ?tab=1 full-screen)   background (SW / event page)
┌───────────────────────────────────────────┐            ┌─────────────────────────────┐
│ React UI (src/popup/)                     │  messages  │ src/background/index.ts     │
│ WASM bridge — ONLY here (needs window)    │◄──────────►│ Encrypted vaults            │
│   src/lib/bridge.ts, send.ts, spent.ts    │            │  (PBKDF2-600k + AES-GCM,    │
│ LWS client src/lib/lws.ts (fetch)         │            │   chrome.storage.local)     │
│ BNS src/lib/bns.ts (explorer API)         │            │ Session in storage.session  │
└───────────────┬───────────────────────────┘            │ Alarms: auto-lock, 30s sync │
                │ view key only                          │ Brute-force backoff         │
                ▼                                        └─────────────────────────────┘
       LWS (scans chain with view key) ──► beldexd
```

Key invariants:
- **WASM never loads in the background** (Emscripten glue needs a window; MV3
  workers are ephemeral). All signing happens in the panel.
- **Decrypted secrets** live only in `chrome.storage.session` (memory-backed,
  never disk) while unlocked; vaults at rest are AES-256-GCM under PBKDF2-600k.
- **Multi-wallet:** each wallet has its own independently-encrypted vault and
  password. Switching locks the session. Legacy single-vault storage migrates
  automatically (`getWallets()` in background).
- **Spend truth:** the LWS's `total_sent`/`spent_outputs` are guesses (any ring
  membership counts). `src/lib/spent.ts` computes key images client-side and
  filters false positives — without this the wallet shows phantom outgoing txs.
- **All atomic math is BigInt** (`src/lib/money.ts`); floats only for fiat display.

### The embind CSP patch (important!)

The published WASM glue used `new Function` (embind's `createNamedFunction` and
`craftInvokerFunction`), which MV3 CSP forbids (`unsafe-eval` is never grantable;
only `wasm-unsafe-eval` is). `patches/@bdxi+beldex-app-bridge+3.0.0.patch`
(applied by `patch-package` on postinstall) rewrites both with eval-free
equivalents (what Emscripten's `-sDYNAMIC_EXECUTION=0` would generate).
`test/bridge.test.mjs` runs under `node --disallow-code-generation-from-strings`
— the same restriction — and exercises every bridge call we use. **If the
`@bdxi/beldex-app-bridge` version is ever bumped, the patch must be re-created
and the tests re-run.** Long-term fix: ask the Beldex team to rebuild
`beldex-core-cpp` with `-sDYNAMIC_EXECUTION=0`.

---

## 3. Feature inventory

- Onboarding: create (seed display → confirm-password + strength hint →
  tap-5-words-in-order quiz) / restore; wallet naming; also reachable from the
  Unlock screen ("+ Create new wallet").
- Dashboard: balance (total / unlocked / locked), hide-balance eye (persisted),
  BDX→USDT price line, sync height with clamped LWS lag, skeleton loaders,
  10s polling while open, address chip (truncated in panel, full in tab mode).
- Send: address **or BNS name** (debounced live resolution, `.bdx` optional),
  amount+address validation, **review modal** (full untruncated address, fresh
  BNS re-resolve at review time, irreversibility warning), animated progress
  (real step codes from the WASM), success tick + tx hash, flash priority
  (priority 5) toggle.
- History: fills remaining screen height, scrolls internally, send/receive
  filter chips, pending badge, **local pending tracking** (just-sent txs appear
  instantly, reconciled against the server, 24h TTL, keyed per address),
  details modal (confirmations, ring size, payment ID + local label, explorer link).
- Receive: full-screen, QR with centered BDX logo (error-correction H),
  **integrated addresses** as "unique addresses" — random or derived from a
  custom label (SHA-256 → 8-byte pid; label stored locally in `pid_labels`,
  shown in tx details). NOTE: true subaddresses are deliberately NOT offered —
  the LWS can't scan them (funds would be invisible). See §5.
- Settings: reveal seed/view key/spend key (password re-verified, masked by
  default with eye, 30s auto-hide, clipboard auto-clear 60s + clear-on-leave),
  change password, rename wallet, auto-lock duration (5m/15m/30m/1h),
  hide-amount-in-notifications toggle, password-gated delete.
- Background: 30s sync alarm, incoming-funds notification (change-return
  heuristic, per-wallet cache), auto-lock alarm that **locks open panels** (via
  storage.onChanged) with activity-based re-arm (TOUCH pings), brute-force
  backoff (5 free tries then 2s→4s→…→60s, persisted in storage.session, applied
  to UNLOCK / REVEAL / CHANGE_PASSWORD / WIPE).

---

## 4. Build / test / load

```bash
npm install            # postinstall applies the embind patch — do not skip
npm run build          # both targets
npm run build:chrome   # -> dist/
npm run build:firefox  # -> firefox/
npm run typecheck
npm test               # CSP-strict WASM bridge tests (6)
npx web-ext lint --source-dir=firefox --self-hosted
```

- Chrome: `chrome://extensions` → Load unpacked → `dist/`
- Firefox: `about:debugging` → Load Temporary Add-on → `firefox/manifest.json`

Both targets share identical `panel.js`/`background.js`; only the manifest
differs. Platform divergence (side panel vs sidebar open/close) is isolated in
`src/lib/platform.ts`; `src/lib/sessionStore.ts` falls back to in-memory session
on Firefox < 115 (works, but sessions die with the event page — 115+ is the real
baseline; the manifest's hard `strict_min_version` was removed for testing and
should be restored before store submission).

**Git convention used throughout:** one logical change per commit, author
`Codeman Crypto <codeman.crypto@beldex.io>` (set `GIT_COMMITTER_*` env too).
When two features touch the same file, intermediate file states were
reconstructed so each commit diff is self-contained.

---

## 5. Known limitations / open items

1. **LWS trust & privacy:** the server sees the view key (incoming funds
   visible to it; cannot spend). `generated_locally: true` is sent even on
   restore — a never-before-seen address may not get full history rescan;
   wiring `IMPORT_WALLET_REQUEST` is a known TODO if the server supports it.
2. **BNS integrity:** resolution fully trusts `explorer.beldex.io` (threat
   model documented in `src/lib/bns.ts`); mitigation is the full-address review
   modal. Buying BNS names is feasible but requires extending `beldex-core-cpp`
   (feasibility study done in-conversation: the WASM contains the BNS code but
   exposes no entry point; LWS relay of BNS txs untested).
3. **Subaddresses:** not supported by the MyMonero-lineage core + LWS. Requires
   LWS-side subaddress registration (à la monero-lws) before touching the client.
4. **No fee display for sends in history** (LWS doesn't return it; the bridge's
   `used_fee` could be cached locally at send time).
5. **Firefox < 115:** in-memory session fallback only; the storage.onChanged
   panel-lock (Fix 1) does not fire there.
6. **AMO data-collection declaration** is `["none"]` — defensible (view key goes
   to the app's own backend), but the team must confirm against Mozilla policy
   before publishing.
7. **Remaining lint warnings (2):** React-internal `innerHTML` — benign,
   non-blocking.
8. **Verify before mainnet ship:** send end-to-end on testnet after any core/
   bridge bump (hard-fork validity: CLSAG since HF15, BP+ since HF20).

## 6. Security review history

Three ship-blockers fixed (panel didn't react to auto-lock; CHANGE_PASSWORD
bypassed backoff; unvalidated send inputs) plus findings 4–14 of the review
(BigInt math, clipboard clear-on-leave, bridge test coverage, persisted backoff,
dead code removal, password-gated wipe, duplicate-import rejection, per-wallet
key-image cache, threat-model docs, notification privacy). `SECURITY_AUDIT.md`
(gitignored, local) and the reviewed `SECURITY-FIXES.md` doc have details.
An earlier user report of "unauthorized transactions" was diagnosed as LWS decoy
false-positives — resolved by the key-image filtering in `spent.ts`.
