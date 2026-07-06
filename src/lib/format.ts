/** "bxcHWKBb4rBE79V...1JGFaFacE" — first/last n chars with … between. Copy actions must use the full value. */
export function truncateMiddle(s: string, n = 15): string {
  if (!s || s.length <= n * 2 + 3) return s
  return `${s.slice(0, n)}...${s.slice(-n)}`
}
