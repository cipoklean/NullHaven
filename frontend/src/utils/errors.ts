export function formatAspError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? '')

  if (message.includes('Error(Contract, #3)')) {
    return 'Only the ASP admin wallet can perform this action. Switch to the admin wallet and try again.'
  }
  if (message.includes('Error(Contract, #4)')) {
    return 'This commitment is already listed on-chain.'
  }
  if (message.includes('Error(Contract, #5)')) {
    return 'This commitment is not on-chain. The local admin cache may be stale; refresh or remove the local entry.'
  }
  if (message.includes('Error(Contract, #6)')) {
    return 'This commitment is already in the opposite ASP list.'
  }
  if (message.toLowerCase().includes('user declined') || message.toLowerCase().includes('rejected')) {
    return 'Transaction signing was cancelled.'
  }

  return message || fallback
}
