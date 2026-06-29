// ─── Shared formatting utilities ─────────────────────────────────────────────

/** Format a stroops value (bigint or string) as a human-readable XLM amount. */
export function formatXlm(stroops: bigint | string): string {
  const n = typeof stroops === 'string' ? Number(stroops) : Number(stroops)
  const xlm = n / 10_000_000
  return xlm.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/** Format a raw balance string (from Horizon) as a human-readable XLM amount. */
export function formatBalance(balance: string): string {
  const n = Number(balance)
  if (!Number.isFinite(n)) return balance
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
