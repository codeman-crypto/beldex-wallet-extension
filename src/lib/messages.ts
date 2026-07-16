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

export interface WalletMeta {
  id: string
  name: string
  address: string // may be '' for legacy wallets until first unlock backfills it
  active: boolean
}

export type BgRequest =
  | { type: 'GET_STATE' }
  | { type: 'SAVE_WALLET'; secrets: WalletSecrets; password: string; name?: string }
  | { type: 'UNLOCK'; password: string }
  | { type: 'LOCK' }
  | { type: 'GET_SECRETS' }
  | { type: 'REVEAL'; password: string }
  | { type: 'CHANGE_PASSWORD'; oldPassword: string; newPassword: string }
  | { type: 'GET_AUTOLOCK' }
  | { type: 'SET_AUTOLOCK'; minutes: number }
  | { type: 'TOUCH' } // user activity in the panel — re-arm the auto-lock timer
  | { type: 'SWITCH_WALLET'; id: string }
  | { type: 'RENAME_WALLET'; name: string } // renames the active wallet
  | { type: 'WIPE' } // deletes the ACTIVE wallet only

export type WalletState = 'uninitialized' | 'locked' | 'unlocked'

export type BgResponse =
  | {
      ok: true
      state?: WalletState
      secrets?: WalletSecrets
      address?: string
      minutes?: number
      walletName?: string
      wallets?: WalletMeta[]
    }
  | { ok: false; error: string }

export function sendToBackground(req: BgRequest): Promise<BgResponse> {
  return chrome.runtime.sendMessage(req)
}
