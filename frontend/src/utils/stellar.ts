import {
  Contract,
  Address,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { CONTRACTS, getContract } from '../config'
import {
  bytesVal,
  vecBytesVal,
  vecU32Val,
  buildAndSubmit,
  simulateCall,
  scValToBytes,
  bytesToHex,
  type SignFn,
} from '../lib/stellar-rpc'
import type { ZKProof, MerkleProof } from './zk'

// Re-export SignFn for consumers
export type { SignFn }

// ─── Public pool API ──────────────────────────────────────────────────────────

/**
 * Deposit any amount of XLM into the pool.
 * @param amountStroops - amount in stroops (1 XLM = 10,000,000 stroops)
 * @param circomRoot - circomlib Merkle root (64-char hex) to register in KnownRoots.
 *                     Pass empty string to skip (will need admin to register later).
 */
export async function deposit(
  source: string,
  commitment: string,
  amountStroops: bigint,
  sign: SignFn,
  circomRoot: string = '',
): Promise<string> {
  const poolAddr = getContract('pool')
  const rootHex = circomRoot || '0'.repeat(64)
  const op = new Contract(poolAddr).call(
    'deposit',
    nativeToScVal(Address.fromString(source), { type: 'address' }),
    bytesVal(commitment),
    nativeToScVal(amountStroops, { type: 'i128' }),
    bytesVal(rootHex),
  )
  return buildAndSubmit(source, op, sign)
}

export interface WithdrawParams {
  to: string
  leafIdx: number
  proof: ZKProof
  merkleProof: MerkleProof
}

/** Withdraw a note with a Groth16 ZK proof. Returns the on-chain tx hash. */
export async function withdraw(
  source: string,
  params: WithdrawParams,
  sign: SignFn,
): Promise<string> {
  const poolAddr = getContract('pool')
  const { proof, merkleProof, to, leafIdx } = params

  // publicSignals layout (7 signals — recipient_hash is the circuit's public OUTPUT at slot 0,
  // from withdraw.sym):
  //   [0]=recipient_hash  [1]=commitment  [2]=root  [3]=nullifier
  //   [4]=recipient_lo    [5]=recipient_hi  [6]=asp_root
  const nullifierHex = proof.publicInputs[3]

  const op = new Contract(poolAddr).call(
    'withdraw',
    nativeToScVal(Address.fromString(to), { type: 'address' }),
    bytesVal(nullifierHex),
    bytesVal(merkleProof.root),
    nativeToScVal(leafIdx, { type: 'u32' }),
    bytesVal(proof.proofA, 64),
    bytesVal(proof.proofB, 128),
    bytesVal(proof.proofC, 64),
    vecBytesVal(proof.publicInputs),
    vecBytesVal(merkleProof.path),
    vecU32Val(merkleProof.indices),
  )
  return buildAndSubmit(source, op, sign)
}

/** Fetch the current ASP root stored on-chain. Returns null if not set. */
export async function getAspRoot(source: string): Promise<string | null> {
  if (!CONTRACTS.pool) return null
  const retval = await simulateCall(source, CONTRACTS.pool, 'get_asp_root')
  if (!retval || retval.switch().name === 'scvVoid') return null
  return bytesToHex(scValToBytes(retval))
}

/**
 * Register a circomlib-compatible Merkle root on-chain via the admin function.
 * Must be called by the pool admin after each deposit.
 */
export async function setKnownRoot(
  source: string,
  rootHex: string,
  sign: SignFn,
): Promise<string> {
  const poolAddr = getContract('pool')
  const op = new Contract(poolAddr).call(
    'set_known_root',
    nativeToScVal(Address.fromString(source), { type: 'address' }),
    bytesVal(rootHex),
  )
  return buildAndSubmit(source, op, sign, 30)
}

/**
 * Fetch all committed leaf hashes from the pool for offline Merkle tree
 * reconstruction.  `source` must be a valid Stellar G-address (funded account)
 * used as the simulation source.
 */
export async function getPoolLeaves(source: string): Promise<string[]> {
  if (!CONTRACTS.pool) return []

  // Get leaf count
  const countVal = await simulateCall(source, CONTRACTS.pool, 'next_idx')
  const count = countVal ? Number(countVal.value() ?? 0) : 0

  if (count === 0) return []

  // Fetch leaves in parallel batches of 10 to avoid overwhelming the RPC
  const BATCH_SIZE = 10
  const leaves: string[] = []

  for (let i = 0; i < count; i += BATCH_SIZE) {
    const batch = Array.from(
      { length: Math.min(BATCH_SIZE, count - i) },
      (_, j) => i + j,
    )
    const results = await Promise.all(
      batch.map((idx) =>
        simulateCall(
          source,
          CONTRACTS.pool,
          'get_leaf',
          nativeToScVal(idx, { type: 'u32' }),
        ),
      ),
    )
    for (const leaf of results) {
      if (leaf && leaf.switch().name !== 'scvVoid') {
        leaves.push(bytesToHex(scValToBytes(leaf)))
      }
    }
  }

  return leaves
}
