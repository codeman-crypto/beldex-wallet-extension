// Clipboard hygiene for secrets (seed, private keys).
//
// copySecret() writes the value, then auto-clears the clipboard after a delay —
// but only if the clipboard still holds OUR value, so we never stomp on
// something the user copied afterwards. Non-secret copies (addresses, tx
// hashes, payment IDs) should keep using plain navigator.clipboard.writeText.

let pendingClear: ReturnType<typeof setTimeout> | undefined

export async function copySecret(value: string, clearAfterMs = 60_000): Promise<void> {
  // cancel any previous pending clear so rapid successive copies don't race
  if (pendingClear) {
    clearTimeout(pendingClear)
    pendingClear = undefined
  }

  await navigator.clipboard.writeText(value)

  pendingClear = setTimeout(async () => {
    pendingClear = undefined
    try {
      // readText needs a focused document — may throw if focus was lost;
      // in that case we simply leave the clipboard alone.
      const current = await navigator.clipboard.readText()
      if (current === value) {
        await navigator.clipboard.writeText(' ')
      }
    } catch {
      // no focus / permission at clear time — nothing we can safely do
    }
  }, clearAfterMs)
}
