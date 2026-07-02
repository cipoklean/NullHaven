import {
  Address,
  Contract,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { CONTRACTS } from '../config'
import {
  bytesVal,
  bytesToHex,
  normalizeHex,
  scValToBytes,
  simulateCall,
  buildAndSubmit,
  type SignFn,
} from '../lib/stellar-rpc'
import { buildMerkleTree, buildPoseidon } from './circuits'
import { deriveFromSecret } from './zk'
import { getPoolLeaves } from './stellar'
import { formatXlm } from './format'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AspEntry {
  commitment: string
  label: string
  addedAt: string
}

export interface ProgressStep {
  label: string
  status: 'pending' | 'active' | 'done' | 'skipped'
}

export type OnProgress = (step: string, status: 'active' | 'done') => void

// ─── localStorage keys ───────────────────────────────────────────────────────

export const LS_MEMBERS = 'nullhaven:asp:members'
export const LS_DENIED  = 'nullhaven:asp:denied'
export const LS_ROOT    = 'nullhaven:asp:root'

// ─── Local list management ───────────────────────────────────────────────────

export function loadAspList(key: string): AspEntry[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as AspEntry[]
  } catch {
    console.warn(`[asp] Failed to parse localStorage key "${key}", returning empty list`)
    return []
  }
}

// ─── On-chain operations ─────────────────────────────────────────────────────

/**
 * Sync the local ASP member list to the on-chain pool contract.
 * Builds a Merkle tree from all member commitments, stores per-member
 * inclusion proofs in localStorage, and calls `set_asp_root` on-chain.
 */
export async function syncAspRoot(
  source: string,
  members: AspEntry[],
  sign: SignFn,
  onProgress?: OnProgress,
): Promise<string> {
  if (members.length === 0) {
    throw new Error('Cannot sync ASP root: allowlist is empty. Add at least one member.')
  }

  const poseidon = await buildPoseidon()
  const leaves = members.map((m) => BigInt('0x' + normalizeHex(m.commitment)))
  const { root, levels } = await buildMerkleTree(leaves)

  // Pad root to 32 levels
  let paddedRoot = root
  for (let d = levels.length - 1; d < 32; d++) {
    paddedRoot = poseidon([paddedRoot, 0n])
  }
  const rootHex = paddedRoot.toString(16).padStart(64, '0')

  // Build and store per-member Merkle inclusion proofs
  for (let idx = 0; idx < members.length; idx++) {
    const path: string[] = []
    const indices: number[] = []
    let i = idx

    for (let lv = 0; lv < levels.length - 1; lv++) {
      const isLeft = i % 2 === 0
      const sibIdx = isLeft ? i + 1 : i - 1
      const sibling = sibIdx < levels[lv].length ? levels[lv][sibIdx] : levels[lv][i]
      path.push(sibling.toString(16).padStart(64, '0'))
      indices.push(isLeft ? 0 : 1)
      i = Math.floor(i / 2)
    }

    // Pad to 32 levels
    while (path.length < 32) {
      path.push('0'.repeat(64))
      indices.push(0)
    }

    const commitmentKey = normalizeHex(members[idx].commitment)
    localStorage.setItem(
      `nullhaven:asp:path:${commitmentKey}`,
      JSON.stringify({ path, indices }),
    )
  }

  localStorage.setItem(LS_ROOT, rootHex)

  const currentRoot = await getCurrentAspRoot(source)
  if (currentRoot && normalizeHex(currentRoot) === normalizeHex(rootHex)) {
    return rootHex
  }

  // Submit on-chain
  onProgress?.('Syncing ASP root on-chain — confirm in wallet', 'active')
  const poolAddr = CONTRACTS.pool
  const op = new Contract(poolAddr).call(
    'set_asp_root',
    nativeToScVal(Address.fromString(source), { type: 'address' }),
    bytesVal(rootHex),
  )
  await buildAndSubmit(source, op, sign, 30)
  onProgress?.('Syncing ASP root on-chain — confirm in wallet', 'done')

  return rootHex
}

async function getCurrentAspRoot(source: string): Promise<string | null> {
  const retval = await simulateCall(source, CONTRACTS.pool, 'get_asp_root')
  if (!retval || retval.switch().name === 'scvVoid') return null
  return bytesToHex(scValToBytes(retval))
}

/**
 * Add a commitment to the ASP allowlist and sync the on-chain root.
 * Returns the normalised commitment and the new root hex.
 */
export async function addAspMember(
  source: string,
  commitmentInput: string,
  label: string,
  sign: SignFn,
  onProgress?: OnProgress,
): Promise<{ commitment: string; root: string }> {
  const commitment = normalizeHex(commitmentInput)
  const existing = loadAspList(LS_MEMBERS)
  const alreadyExists = existing.some(
    (m) => normalizeHex(m.commitment) === commitment,
  )

  const members = alreadyExists
    ? existing
    : [...existing, { commitment, label: label || 'deposit', addedAt: new Date().toISOString() }]

  // Even if localStorage has it, verify on-chain — localStorage can drift
  // if a previous tx timed out during confirmation polling.
  const onChainMember = await isAspMember(source, commitment)

  if (!onChainMember) {
    // Add on-chain (always, regardless of localStorage state)
    onProgress?.('Adding commitment to ASP allowlist — confirm in wallet', 'active')
    const aspAddr = CONTRACTS.asp
    const op = new Contract(aspAddr).call(
      'add_member',
      nativeToScVal(Address.fromString(source), { type: 'address' }),
      bytesVal(commitment),
    )
    await buildAndSubmit(source, op, sign, 30)
    onProgress?.('Adding commitment to ASP allowlist — confirm in wallet', 'done')
  }

  // Always persist to localStorage (covers both new entries and drift correction)
  localStorage.setItem(LS_MEMBERS, JSON.stringify(members))

  const root = await syncAspRoot(source, members, sign, onProgress)
  return { commitment, root }
}

/**
 * Move a commitment to the on-chain ASP denylist.
 * If the commitment is allowlisted locally, remove it on-chain first because the
 * ASP contract enforces mutual exclusion between allowlist and denylist.
 */
export async function addAspDenied(
  source: string,
  commitmentInput: string,
  label: string,
  sign: SignFn,
  onProgress?: OnProgress,
): Promise<{ commitment: string; root: string | null }> {
  const commitment = normalizeHex(commitmentInput)
  let members = loadAspList(LS_MEMBERS)

  // Always check on-chain state, not just localStorage — localStorage can be out of sync
  const isOnChainMember = await isAspMember(source, commitment)
  const wasMember = isOnChainMember || members.some((m) => normalizeHex(m.commitment) === commitment)

  if (wasMember) {
    onProgress?.('Removing from allowlist first — confirm in wallet', 'active')
    const removeOp = new Contract(CONTRACTS.asp).call(
      'remove_member',
      nativeToScVal(Address.fromString(source), { type: 'address' }),
      bytesVal(commitment),
    )
    await buildAndSubmit(source, removeOp, sign, 30)
    onProgress?.('Removing from allowlist first — confirm in wallet', 'done')
    members = members.filter((m) => normalizeHex(m.commitment) !== commitment)
    localStorage.setItem(LS_MEMBERS, JSON.stringify(members))
    localStorage.removeItem(`nullhaven:asp:path:${commitment}`)
  }

  // Verify not already denied on-chain
  const isDeniedOnChain = await isAspDenied(source, commitment)
  const existingDenied = loadAspList(LS_DENIED)
  const alreadyDenied = isDeniedOnChain || existingDenied.some((m) => normalizeHex(m.commitment) === commitment)

  if (!alreadyDenied) {
    onProgress?.('Adding to ASP denylist — confirm in wallet', 'active')
    const denyOp = new Contract(CONTRACTS.asp).call(
      'add_denied',
      nativeToScVal(Address.fromString(source), { type: 'address' }),
      bytesVal(commitment),
    )
    await buildAndSubmit(source, denyOp, sign, 30)
    onProgress?.('Adding to ASP denylist — confirm in wallet', 'done')
    localStorage.setItem(LS_DENIED, JSON.stringify([
      ...existingDenied,
      { commitment, label: label || 'denied', addedAt: new Date().toISOString() },
    ]))
  }

  const root = members.length > 0 ? await syncAspRoot(source, members, sign, onProgress) : null
  if (members.length === 0) {
    localStorage.removeItem(LS_ROOT)
  }
  return { commitment, root }
}

/** Read the on-chain denylist status from the ASP contract. */
export async function isAspDenied(source: string, commitmentInput: string): Promise<boolean> {
  const retval = await simulateCall(source, CONTRACTS.asp, 'is_denied', bytesVal(normalizeHex(commitmentInput)))
  return retval ? Boolean(retval.value()) : false
}

/** Read the on-chain allowlist status from the ASP contract. */
export async function isAspMember(source: string, commitmentInput: string): Promise<boolean> {
  const retval = await simulateCall(source, CONTRACTS.asp, 'is_member', bytesVal(normalizeHex(commitmentInput)))
  return retval ? Boolean(retval.value()) : false
}

// ─── Input validation ────────────────────────────────────────────────────────

export interface InputValidation {
  kind: 'commitment' | 'secret-derived' | 'unknown'
  commitment: string
  depositMatch?: { amount: string; date: string }
  fromOnChain?: boolean
}

/** Scan all localStorage deposit records across all wallets. */
function getAllLocalDeposits(): Array<{ commitment: string; amount?: string; date?: string }> {
  const deposits: Array<{ commitment: string; amount?: string; date?: string }> = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('nullhaven:deposits:')) {
      try {
        const list = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ commitment: string; amount?: string; date?: string }>
        for (const d of list) {
          if (d.commitment) deposits.push(d)
        }
      } catch { /* skip malformed */ }
    }
  }
  return deposits
}

/** Format a stroops string (e.g. "10000000") as "1 XLM". */
export function formatStroopsAmount(stroops: string): string {
  return formatXlm(stroops) + ' XLM'
}

/**
 * Validate an admin input before adding to allowlist/denylist.
 * Checks against local deposits, tries deriving as a secret,
 * and falls back to on-chain pool leaf lookup.
 */
export async function validateCommitmentInput(
  rawInput: string,
  source: string,
): Promise<InputValidation> {
  const normalized = normalizeHex(rawInput)

  // 1. Check against local deposits (instant)
  const localDeposits = getAllLocalDeposits()
  const directLocal = localDeposits.find((d) => normalizeHex(d.commitment) === normalized)
  if (directLocal) {
    return {
      kind: 'commitment',
      commitment: normalized,
      depositMatch: directLocal.amount
        ? { amount: directLocal.amount, date: directLocal.date ?? '' }
        : undefined,
    }
  }

  // 2. Try deriving as a secret, check local deposits
  try {
    const { commitment: derived } = await deriveFromSecret(rawInput)
    const derivedNorm = normalizeHex(derived)
    const derivedLocal = localDeposits.find((d) => normalizeHex(d.commitment) === derivedNorm)
    if (derivedLocal) {
      return {
        kind: 'secret-derived',
        commitment: derivedNorm,
        depositMatch: derivedLocal.amount
          ? { amount: derivedLocal.amount, date: derivedLocal.date ?? '' }
          : undefined,
      }
    }
  } catch { /* not valid hex input */ }

  // 3. Check against on-chain pool leaves (with 5s timeout to avoid blocking UI)
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    const leaves = await Promise.race([getPoolLeaves(source), timeout])
    const directLeaf = leaves.find((l) => normalizeHex(l) === normalized)
    if (directLeaf) {
      return { kind: 'commitment', commitment: normalized, fromOnChain: true }
    }

    // Try derived commitment against on-chain leaves
    try {
      const { commitment: derived } = await deriveFromSecret(rawInput)
      const derivedNorm = normalizeHex(derived)
      const derivedLeaf = leaves.find((l) => normalizeHex(l) === derivedNorm)
      if (derivedLeaf) {
        return { kind: 'secret-derived', commitment: derivedNorm, fromOnChain: true }
      }
    } catch {}
  } catch { /* can't fetch leaves or timed out */ }

  // 4. Not recognized anywhere
  return { kind: 'unknown', commitment: normalized }
}
