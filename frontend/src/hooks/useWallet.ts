import { useState, useEffect, useCallback } from 'react'
import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction as freighterSign,
} from '@stellar/freighter-api'
import { HORIZON_URL, NETWORK_PASSPHRASE } from '../config'

async function fetchXlmBalance(publicKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`)
    if (!res.ok) return null
    const account = await res.json() as { balances?: Array<{ asset_type: string; balance: string }> }
    return account.balances?.find((b) => b.asset_type === 'native')?.balance ?? null
  } catch {
    return null
  }
}

const DISCONNECT_KEY = 'nullhaven:wallet:disconnected'

export function useWallet() {
  const [publicKey,  setPublicKey]  = useState<string | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [networkOk,  setNetworkOk]  = useState(false)  // true when Freighter is on Testnet
  const [balance,    setBalance]    = useState<string | null>(null)

  const refreshBalance = useCallback(async (address = publicKey) => {
    if (!address) {
      setBalance(null)
      return
    }
    setBalance(await fetchXlmBalance(address))
  }, [publicKey])

  const checkConnection = useCallback(async () => {
    // Respect explicit disconnect — don't auto-reconnect if user disconnected
    if (localStorage.getItem(DISCONNECT_KEY) === 'true') return
    try {
      const connected = await isConnected()
      if (connected.isConnected) {
        const [{ address }, { networkPassphrase: pass }] = await Promise.all([
          getAddress(),
          getNetwork(),
        ])
        setPublicKey(address)
        setNetworkOk(pass === NETWORK_PASSPHRASE)
        if (pass === NETWORK_PASSPHRASE) void refreshBalance(address)
      }
    } catch { /* not connected */ }
  }, [refreshBalance])

  // Auto-detect existing connection on mount
  useEffect(() => {
    queueMicrotask(() => { void checkConnection() })
  }, [checkConnection])

  /** Connect to Freighter and validate the network is Testnet. */
  const connectWallet = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Clear disconnect flag — user is explicitly connecting
      localStorage.removeItem(DISCONNECT_KEY)

      // Request access — Freighter prompts the user to approve
      const { address } = await requestAccess()
      setPublicKey(address)

      // Check what network Freighter is actually on
      const { networkPassphrase: activePass } = await getNetwork()
      const onTestnet = activePass === NETWORK_PASSPHRASE
      setNetworkOk(onTestnet)
      if (onTestnet) void refreshBalance(address)

      if (!onTestnet) {
        setError(
          `Freighter is on Mainnet. Open Freighter → Settings → Network → switch to "Testnet", then reconnect.`
        )
        setPublicKey(null)
        setBalance(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect wallet')
    } finally {
      setLoading(false)
    }
  }, [refreshBalance])

  const disconnectWallet = useCallback(() => {
    setPublicKey(null)
    setNetworkOk(false)
    setBalance(null)
    // Persist disconnect so auto-detect doesn't reconnect on next load
    localStorage.setItem(DISCONNECT_KEY, 'true')
  }, [])

  useEffect(() => {
    const onRefresh = () => { void refreshBalance() }
    window.addEventListener('nullhaven:refresh-balance', onRefresh)
    return () => window.removeEventListener('nullhaven:refresh-balance', onRefresh)
  }, [refreshBalance])

  /** Sign a Soroban transaction. Passes testnet passphrase so Freighter validates network. */
  const sign = useCallback(async (txXdr: string): Promise<string> => {
    try {
      const { signedTxXdr } = await freighterSign(txXdr, { networkPassphrase: NETWORK_PASSPHRASE })
      return signedTxXdr
    } catch (e) {
      throw new Error('Transaction signing was rejected', { cause: e })
    }
  }, [])

  return {
    publicKey,
    loading,
    error,
    balance,
    refreshBalance,
    connectWallet,
    disconnectWallet,
    sign,
    isConnected: !!publicKey && networkOk,
    isTestnet:  networkOk,
  }
}
