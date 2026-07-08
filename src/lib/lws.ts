// Minimal client for the Beldex light-wallet-server (LWS) HTTP API.
// Endpoint shapes are defined in the core repo: beldex/src/wallet/wallet_light_rpc.h
// (LOGIN, GET_ADDRESS_INFO, GET_ADDRESS_TXS, GET_UNSPENT_OUTS, SUBMIT_RAW_TX).
// The server scans the chain with your *view* key; spend keys never leave the client.

import { CONFIG } from './config'

/** Verbatim POST used by the send flow — the WASM builds these request bodies itself. */
export function rawPost<T = any>(endpoint: string, body: unknown): Promise<T> {
  return post<T>(endpoint, body)
}

async function post<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${CONFIG.LWS_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`LWS ${endpoint} failed: ${res.status}`)
  return res.json()
}

export interface Credentials {
  address: string
  view_key: string
}

/** Register/login the address with the LWS so it starts (or resumes) scanning. */
export function login(c: Credentials, createAccount = true) {
  return post<{ new_address: boolean; start_height?: number }>('/login', {
    address: c.address,
    view_key: c.view_key,
    create_account: createAccount,
    generated_locally: true
  })
}

/** Balance summary: total_received, total_sent (needs key-image filtering), scan height. */
export function getAddressInfo(c: Credentials) {
  return post<any>('/get_address_info', c)
}

/** Transaction list for history display. */
export function getAddressTxs(c: Credentials) {
  return post<any>('/get_address_txs', c)
}

/**
 * Unspent outputs for spending. NOTE: `total_sent` from the server is a hint —
 * true spent-detection requires computing key images client-side
 * (bridge.generateKeyImage) and filtering, since only we hold the spend key.
 * See @bdxi/beldex-response-parser-utils / beldex-keyimage-cache for reference.
 */
export function getUnspentOuts(c: Credentials, extra: Record<string, unknown> = {}) {
  return post<any>('/get_unspent_outs', {
    ...c,
    amount: '0',
    mixin: 10,
    use_dust: true,
    dust_threshold: '2000000000',
    ...extra
  })
}

/** Decoy outputs for ring signatures. */
export function getRandomOuts(amounts: string[], count: number) {
  return post<any>('/get_random_outs', { amounts, count })
}

/** Broadcast a signed transaction. */
export function submitRawTx(c: Credentials, txHex: string) {
  return post<any>('/submit_raw_tx', { ...c, tx: txHex })
}

// BNS name resolution lives in lib/bns.ts (daemon `bns_lookup` RPC).
