// Typed message contracts between popup and background service worker.

export interface WalletSecrets {
  mnemonic: string
  address: string
  pubSpendKey: string
  pubViewKey: string
  secViewKey: string
  secSpendKey: string
  seed: string
}

export type BgRequest =
  | { type: 'GET_STATE' }
  | { type: 'SAVE_WALLET'; secrets: WalletSecrets; password: string }
  | { type: 'UNLOCK'; password: string }
  | { type: 'LOCK' }
  | { type: 'GET_SECRETS' }
  | { type: 'REVEAL'; password: string }
  | { type: 'CHANGE_PASSWORD'; oldPassword: string; newPassword: string }
  | { type: 'GET_AUTOLOCK' }
  | { type: 'SET_AUTOLOCK'; minutes: number }
  | { type: 'WIPE' }

export type WalletState = 'uninitialized' | 'locked' | 'unlocked'

export type BgResponse =
  | { ok: true; state?: WalletState; secrets?: WalletSecrets; address?: string; minutes?: number }
  | { ok: false; error: string }

export function sendToBackground(req: BgRequest): Promise<BgResponse> {
  return chrome.runtime.sendMessage(req)
}
