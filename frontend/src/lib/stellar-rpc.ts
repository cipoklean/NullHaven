import {
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'
import { NETWORK_PASSPHRASE, RPC_URL } from '../config'

// ─── Shared RPC client (singleton) ───────────────────────────────────────────
// Every module that needs chain access should import from here instead of
// creating its own `new rpc.Server(...)`.

export const rpcClient = new rpc.Server(RPC_URL)

// ─── XDR helpers ─────────────────────────────────────────────────────────────
// Shared hex↔ScVal conversion used by both stellar.ts and asp.ts.

function hexToU8(hex: string, byteLen = 32): Uint8Array {
  const clean = hex.replace(/^0x/i, '').padStart(byteLen * 2, '0')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16)
  }
  return out
}

export function bytesVal(hex: string, byteLen = 32): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(hexToU8(hex, byteLen)))
}

export function normalizeHex(input: string): string {
  return input.trim().replace(/^0x/i, '').padStart(64, '0').toLowerCase()
}

export function vecBytesVal(hexArr: string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(hexArr.map((h) => bytesVal(h)))
}

export function vecU32Val(nums: number[]): xdr.ScVal {
  return xdr.ScVal.scvVec(nums.map((n) => nativeToScVal(n, { type: 'u32' })))
}

// ─── Transaction lifecycle ───────────────────────────────────────────────────

export type SignFn = (txXdr: string) => Promise<string>

/**
 * Build a Soroban transaction, simulate, assemble, sign, submit, and poll for
 * confirmation. Returns the tx hash once accepted; slow confirmation polling is
 * reported as pending instead of failed because the tx may still land on-chain.
 * Retries up to 3 times on txBadSeq (stale sequence number).
 */
export async function buildAndSubmit(
  source: string,
  op: xdr.Operation,
  sign: SignFn,
  timeoutSeconds = 60,
): Promise<string> {
  const MAX_RETRIES = 3

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const account = await rpcClient.getAccount(source)
    const baseTx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(timeoutSeconds)
      .build()

    // Simulate to get resource footprint + fee
    const sim = await rpcClient.simulateTransaction(baseTx)
    if (rpc.Api.isSimulationError(sim)) {
      const err = (sim as rpc.Api.SimulateTransactionErrorResponse).error
      throw new Error(
        `Simulation failed: ${typeof err === 'string' ? err : JSON.stringify(err)}`,
      )
    }

    const prepared = rpc.assembleTransaction(
      baseTx,
      sim as rpc.Api.SimulateTransactionSuccessResponse,
    ).build()

    const signedXdr = await sign(prepared.toXDR())
    const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE)

    const sendRes = await rpcClient.sendTransaction(signedTx)
    if (sendRes.status === 'ERROR') {
      const errJson = JSON.stringify(sendRes.errorResult)
      // Retry on stale sequence number
      if (errJson.includes('txBadSeq') && attempt < MAX_RETRIES - 1) {
        console.warn(`[buildAndSubmit] txBadSeq, retrying (${attempt + 1}/${MAX_RETRIES})...`)
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      throw new Error(`Transaction submission rejected: ${errJson}`)
    }

    const { hash } = sendRes
    const maxPolls = 30
    const pollIntervalMs = 2000

    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, pollIntervalMs))
      const status = await rpcClient.getTransaction(hash)
      if (status.status === rpc.Api.GetTransactionStatus.SUCCESS) return hash
      if (status.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(
          `Transaction failed on-chain (hash: ${hash}). Check Stellar Expert for details.`,
        )
      }
    }
    console.warn(
      `[buildAndSubmit] Confirmation still pending after ${(maxPolls * pollIntervalMs) / 1000}s; ` +
      `returning accepted tx hash ${hash}.`,
    )
    return hash
  }
  throw new Error('Transaction failed after all retries.')
}

/**
 * Simulate a read-only contract call and return the raw ScVal result.
 * Returns null on simulation error (contract not configured, method missing, etc.).
 */
export async function simulateCall(
  source: string,
  contractId: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<xdr.ScVal | null> {
  try {
    const account = await rpcClient.getAccount(source)
    const contract = new Contract(contractId)
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build()
    const res = await rpcClient.simulateTransaction(tx)
    if (rpc.Api.isSimulationError(res)) return null
    return (res as rpc.Api.SimulateTransactionSuccessResponse).result?.retval ?? null
  } catch (e) {
    console.warn(`[stellar-rpc] simulateCall(${method}) failed:`, e)
    return null
  }
}

/** Extract a Uint8Array from an ScVal bytes return value. */
export function scValToBytes(val: xdr.ScVal): Uint8Array {
  return val.value() as Uint8Array
}

/** Convert a Uint8Array to a hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
