// Wrapper around @bdxi/beldex-app-bridge (the Emscripten glue + BeldexLibAppCpp_WASM).
// IMPORTANT: only import this from popup/extension-page code, NOT from the
// background service worker — the glue's web path expects a window/document,
// and locateFile resolves the wasm at "/assets/BeldexLibAppCpp_WASM.wasm"
// (= chrome-extension://<id>/assets/..., copied there by webpack).

import { CONFIG } from './config'
import type { WalletSecrets } from './messages'

// @ts-ignore — no type definitions published for the bridge package
import loadBridge from '@bdxi/beldex-app-bridge'

let bridgePromise: Promise<any> | undefined

export function getBridge(): Promise<any> {
  if (!bridgePromise) bridgePromise = loadBridge({}) as Promise<any>
  return bridgePromise!
}

function assertNoErr<T extends { err_msg?: string }>(res: T): T {
  if (res && res.err_msg) throw new Error(res.err_msg)
  return res
}

export async function createWallet(localeCode = 'en-US'): Promise<WalletSecrets> {
  const bridge = await getBridge()
  const r = assertNoErr(bridge.newly_created_wallet(localeCode, CONFIG.NETTYPE))
  return {
    mnemonic: r.mnemonic_string,
    seed: r.sec_seed_string,
    address: r.address_string,
    pubSpendKey: r.pub_spendKey_string,
    pubViewKey: r.pub_viewKey_string,
    secViewKey: r.sec_viewKey_string,
    secSpendKey: r.sec_spendKey_string
  }
}

export async function restoreFromMnemonic(mnemonic: string): Promise<WalletSecrets> {
  const bridge = await getBridge()
  const r = assertNoErr(bridge.seed_and_keys_from_mnemonic(mnemonic, CONFIG.NETTYPE))
  return {
    mnemonic,
    seed: r.sec_seed_string,
    address: r.address_string,
    pubSpendKey: r.pub_spendKey_string,
    pubViewKey: r.pub_viewKey_string,
    secViewKey: r.sec_viewKey_string,
    secSpendKey: r.sec_spendKey_string
  }
}

/** Returns { spend, view, isSubaddress } (verified against the v3.0.0 wasm). Throws on invalid address. */
export async function decodeAddress(
  address: string
): Promise<{ spend: string; view: string; isSubaddress: boolean }> {
  const bridge = await getBridge()
  return assertNoErr(bridge.decode_address(address, CONFIG.NETTYPE))
}

export async function generateKeyImage(
  txPubKey: string,
  secViewKey: string,
  pubSpendKey: string,
  secSpendKey: string,
  outIndex: number
): Promise<string> {
  const bridge = await getBridge()
  const r = assertNoErr(bridge.generate_key_image(txPubKey, secViewKey, pubSpendKey, secSpendKey, outIndex))
  return r.retVal ?? r
}

export async function estimatedTxFee(feePerB: string, priority: number, forkVersion: number): Promise<string> {
  const bridge = await getBridge()
  const r = bridge.estimated_tx_network_fee(null, priority, feePerB) // verify arg order against MyMoneroCoreBridgeEssentialsClass
  return typeof r === 'object' ? r.retVal : r
}
