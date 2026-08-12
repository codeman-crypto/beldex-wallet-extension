// Custom-string payment IDs.
//
// A short payment ID is 8 bytes (16 hex chars). We derive one from a user's
// label via SHA-256(salt ‖ label) — deterministic per browser profile, so the
// same label always produces the same ID *here*, but the salt (random 32
// bytes, generated on first use) prevents anyone from precomputing PIDs for
// common labels ("rent", "invoice-1") and linking on-chain payments to
// guessed labels (audit L5). The label itself never leaves this browser: the
// chain carries only the 8-byte ID, and we keep a local pid -> label map to
// show the friendly name again in transaction details.

const LABELS_KEY = 'pid_labels'
const SALT_KEY = 'pid_salt'

async function getSalt(): Promise<Uint8Array> {
  const existing = (await chrome.storage.local.get(SALT_KEY))[SALT_KEY]
  if (typeof existing === 'string' && /^[0-9a-f]{64}$/.test(existing)) {
    return new Uint8Array(existing.match(/../g)!.map(h => parseInt(h, 16)))
  }
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const hex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  await chrome.storage.local.set({ [SALT_KEY]: hex })
  return salt
}

export async function deriveShortPid(label: string): Promise<string> {
  const salt = await getSalt()
  const labelBytes = new TextEncoder().encode(label.trim())
  const input = new Uint8Array(salt.length + labelBytes.length)
  input.set(salt)
  input.set(labelBytes, salt.length)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function getPidLabels(): Promise<Record<string, string>> {
  return (await chrome.storage.local.get(LABELS_KEY))[LABELS_KEY] ?? {}
}

export async function savePidLabel(pid: string, label: string): Promise<void> {
  const labels = await getPidLabels()
  labels[pid] = label.trim()
  await chrome.storage.local.set({ [LABELS_KEY]: labels })
}
