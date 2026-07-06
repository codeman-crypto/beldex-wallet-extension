// Client-side spend verification (key-image filtering).
//
// The LWS cannot know which outputs we actually spent — it flags an output as
// "possibly spent" whenever it appears as a ring member in ANY transaction,
// including other people's transactions that sampled it as a decoy. Deciding
// truthfully requires the private spend key, which only we hold: compute the
// key image for each candidate (tx_pub_key, out_index) and compare with the
// candidate's key_image. Match => genuinely ours. No match => decoy usage.
//
// Without this filtering the wallet shows phantom outgoing transactions and an
// understated balance. (Same approach as MyMonero's response parser.)

import { generateKeyImage } from './bridge'
import type { WalletSecrets } from './messages'

export interface SpentCandidate {
  amount: string
  key_image: string
  tx_pub_key: string
  out_index: number
}

// key images are deterministic per (txPub, outIndex, keys) — cache for the panel's lifetime
const kiCache = new Map<string, string>()

async function ourKeyImage(s: WalletSecrets, txPub: string, outIndex: number): Promise<string> {
  const k = `${txPub}:${outIndex}`
  let ki = kiCache.get(k)
  if (!ki) {
    ki = await generateKeyImage(txPub, s.secViewKey, s.pubSpendKey, s.secSpendKey, outIndex)
    kiCache.set(k, ki)
  }
  return ki
}

/** Sum of candidate amounts that are NOT really ours (false positives to subtract from total_sent). */
export async function falseSpendSum(s: WalletSecrets, candidates: SpentCandidate[] | undefined): Promise<number> {
  let fake = 0
  for (const c of candidates ?? []) {
    try {
      const ki = await ourKeyImage(s, c.tx_pub_key, Number(c.out_index))
      if (ki !== c.key_image) fake += Number(c.amount)
    } catch {
      // can't verify this candidate — leave it counted as spent (conservative for balance)
    }
  }
  return fake
}

/** Corrects total_sent on an object bearing { total_sent, spent_outputs }. Returns the corrected number. */
export async function correctedTotalSent(
  s: WalletSecrets,
  obj: { total_sent?: string | number; spent_outputs?: SpentCandidate[] }
): Promise<number> {
  const claimed = Number(obj.total_sent ?? 0)
  if (!obj.spent_outputs?.length || claimed === 0) return claimed
  const fake = await falseSpendSum(s, obj.spent_outputs)
  return Math.max(0, claimed - fake)
}
