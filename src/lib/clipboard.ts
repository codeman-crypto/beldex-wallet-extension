// Clipboard hygiene for secrets (seed, private keys).
//
// copySecret() writes the value and schedules a clear, but only overwrites if
// the clipboard still holds OUR value, so we never stomp on something the user
// copied afterwards. The timed clear is best-effort: an extension panel has no
// way to run a timer after it closes, so callers should also clearSecretNow()
// on unmount / navigation to clear promptly while the panel is still alive.
// Non-secret copies (addresses, tx hashes, payment IDs) use plain writeText.

let pendingClear: ReturnType<typeof setTimeout> | undefined
let trackedValue: string | undefined

/** Overwrite the clipboard iff it still holds `value` (best-effort; needs focus). */
async function clearIfStillOurs(value: string): Promise<void> {
  try {
    // readText needs a focused document — may throw if focus was lost.
    const current = await navigator.clipboard.readText()
    if (current === value) await navigator.clipboard.writeText(' ')
  } catch {
    // no focus / permission — leave the clipboard alone
  }
}

export async function copySecret(value: string, clearAfterMs = 60_000): Promise<void> {
  if (pendingClear) { clearTimeout(pendingClear); pendingClear = undefined }
  trackedValue = value
  await navigator.clipboard.writeText(value)
  pendingClear = setTimeout(() => {
    pendingClear = undefined
    const v = trackedValue
    trackedValue = undefined
    if (v) clearIfStillOurs(v)
  }, clearAfterMs)
}

/**
 * Clear the tracked secret from the clipboard immediately. Call this while the
 * panel is still open (e.g. on unmount or when leaving the reveal screen) so a
 * secret isn't left behind when the timed clear can no longer run.
 */
export function clearSecretNow(): void {
  if (pendingClear) { clearTimeout(pendingClear); pendingClear = undefined }
  const v = trackedValue
  trackedValue = undefined
  if (v) clearIfStillOurs(v)
}
