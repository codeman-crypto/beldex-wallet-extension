// Custom-string payment IDs.
//
// A short payment ID is 8 bytes (16 hex chars). We derive one from a user's
// label via SHA-256 (first 8 bytes) — deterministic, so the same label always
// produces the same ID. The label itself never leaves this browser: the chain
// carries only the 8-byte ID, and we keep a local pid -> label map to show the
// friendly name again in transaction details.

const LABELS_KEY = 'pid_labels'

export async function deriveShortPid(label: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(label.trim()))
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
