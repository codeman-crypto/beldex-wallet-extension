// BDX price via CoinGecko (coin id "beldex"). Cached for 60s to stay well
// under the free-tier rate limit even though the dashboard refreshes every 10s.
// Disabled entirely on testnet builds (CONFIG.SHOW_FIAT) — testnet coins have
// no market value, and CoinGecko isn't in that build's host_permissions.

import { CONFIG } from './config'

const TTL_MS = 60_000

let cached: { price: number; at: number } | null = null

/** Returns the BDX price in USDT (falls back to USD if CoinGecko lacks a USDT quote), or null on failure. */
export async function getBdxPriceUsdt(): Promise<number | null> {
  if (!CONFIG.SHOW_FIAT) return null
  if (cached && Date.now() - cached.at < TTL_MS) return cached.price
  try {
    const res = await fetch(CONFIG.PRICE_URL)
    if (!res.ok) throw new Error(String(res.status))
    const json = await res.json()
    const p = Number(json?.beldex?.usdt ?? json?.beldex?.usd)
    if (!Number.isFinite(p) || p <= 0) return cached?.price ?? null
    cached = { price: p, at: Date.now() }
    return p
  } catch {
    return cached?.price ?? null // stale price beats no price; null only if never fetched
  }
}
