// Atomic-unit money math in BigInt. 1 BDX = 1e9 atomic units. JS `Number` loses
// integer precision above 2^53 (~9,007,199 BDX), so all balance/amount
// arithmetic goes through BigInt; only fiat estimates fall back to float.

export const ATOMIC = 1_000_000_000n // atomic units per BDX
export const DECIMALS = 9

/** Parse an atomic value coming from the LWS (integer string or number) to BigInt. */
export function parseAtomic(v: string | number | undefined | null): bigint {
  if (v === undefined || v === null || v === '') return 0n
  const s = String(v).trim()
  // atomic amounts are integers; guard against an unexpected decimal point
  const intPart = s.split('.')[0].replace(/[^\d-]/g, '')
  try {
    return BigInt(intPart || '0')
  } catch {
    return 0n
  }
}

/** Convert a user-entered BDX amount ("1.25") to atomic units. Assumes validated input. */
export function toAtomic(display: string): bigint {
  const [whole = '', frac = ''] = display.trim().split('.')
  const fracPadded = (frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS)
  const w = whole.replace(/[^\d]/g, '') || '0'
  return BigInt(w) * ATOMIC + BigInt(fracPadded || '0')
}

/** Format atomic units as a BDX string with `dp` decimal places (default 4). */
export function fmtBDX(atomic: bigint, dp = 4): string {
  const neg = atomic < 0n
  const a = neg ? -atomic : atomic
  const whole = a / ATOMIC
  const fracStr = (a % ATOMIC).toString().padStart(DECIMALS, '0').slice(0, dp)
  return `${neg ? '-' : ''}${whole}${dp > 0 ? '.' + fracStr : ''}`
}

export function absBig(x: bigint): bigint {
  return x < 0n ? -x : x
}

/** Float BDX value for fiat estimates only — precision loss here is acceptable. */
export function toBdxFloat(atomic: bigint): number {
  return Number(atomic) / 1e9
}
