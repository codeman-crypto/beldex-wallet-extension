// Session storage with a fallback for browsers without chrome.storage.session
// (Firefox < 115). Native storage.session is memory-backed, never hits disk,
// and is shared across the extension's contexts — ideal for holding an unlocked
// keyring. When it's missing we fall back to an in-memory object in the current
// context.
//
// Fallback tradeoff: the in-memory store is per-context (the background's copy
// isn't visible to the panel) and is lost whenever the background event page
// unloads — so the user may have to unlock again more often. We deliberately do
// NOT fall back to storage.local: decrypted keys must never touch disk. The
// proper fix is Firefox 115+; this keeps older versions usable, not ideal.

const native = (chrome.storage as any)?.session as chrome.storage.StorageArea | undefined

const mem = new Map<string, unknown>()

export const hasNativeSession = !!native

export const sessionStore = {
  async get(key: string): Promise<Record<string, any>> {
    if (native) return native.get(key)
    return { [key]: mem.get(key) }
  },
  async set(items: Record<string, unknown>): Promise<void> {
    if (native) return native.set(items)
    for (const [k, v] of Object.entries(items)) mem.set(k, v)
  },
  async remove(keys: string | string[]): Promise<void> {
    if (native) return native.remove(keys)
    for (const k of Array.isArray(keys) ? keys : [keys]) mem.delete(k)
  }
}
