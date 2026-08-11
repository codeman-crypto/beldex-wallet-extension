// Locally-tracked outgoing transactions: bridge the gap between broadcast and
// the LWS indexing the tx, so sends appear in history IMMEDIATELY (marked
// pending). Written by both the panel's send flow and dapp-initiated sends
// (SendApprovalCard); read/reconciled by the Dashboard history.

export interface PendingLocalTx { hash: string; sentAtomic: string; timestamp: string }

export const PENDING_TTL_MS = 24 * 3600 * 1000 // give up tracking after a day

// keyed per wallet address so multiple wallets don't see each other's pendings
export const pendingKey = (address: string) => `pending_txs_${address}`

export async function getPendingLocal(address: string): Promise<PendingLocalTx[]> {
  return (await chrome.storage.local.get(pendingKey(address)))[pendingKey(address)] ?? []
}

export async function addPendingLocal(address: string, tx: PendingLocalTx): Promise<void> {
  const list = await getPendingLocal(address)
  if (!list.some(p => p.hash === tx.hash)) {
    await chrome.storage.local.set({ [pendingKey(address)]: [tx, ...list] })
  }
}

/** Drop entries the server now knows about (or stale ones); return those still unknown. */
export async function reconcilePendingLocal(address: string, serverHashes: Set<string>): Promise<PendingLocalTx[]> {
  const list = await getPendingLocal(address)
  const still = list.filter(p =>
    !serverHashes.has(p.hash) && Date.now() - new Date(p.timestamp).getTime() < PENDING_TTL_MS)
  if (still.length !== list.length) await chrome.storage.local.set({ [pendingKey(address)]: still })
  return still
}
