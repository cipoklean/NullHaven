import { buildPoseidon as circomBuildPoseidon } from 'circomlibjs'

type PoseidonFn = (inputs: bigint[]) => bigint

let _poseidon: PoseidonFn | null = null

/**
 * Returns a memoised Poseidon hash function backed by circomlibjs / WASM.
 * Calling this multiple times is safe — WASM loads once.
 */
export async function buildPoseidon(): Promise<PoseidonFn> {
  if (_poseidon) return _poseidon
  const p = await circomBuildPoseidon()
  _poseidon = (inputs: bigint[]) => p.F.toObject(p(inputs)) as bigint
  return _poseidon
}

/**
 * Build a full binary Merkle tree using Poseidon hashing.
 * Odd-length levels duplicate the last leaf — matches circomlib MerkleTreeChecker.
 */
export async function buildMerkleTree(
  leaves: bigint[],
): Promise<{ root: bigint; levels: bigint[][] }> {
  const poseidon = await buildPoseidon()
  const levels: bigint[][] = [leaves]
  let current = leaves

  while (current.length > 1) {
    const next: bigint[] = []
    for (let i = 0; i < current.length; i += 2) {
      const left  = current[i]
      const right = i + 1 < current.length ? current[i + 1] : left
      next.push(poseidon([left, right]))
    }
    levels.push(next)
    current = next
  }

  return { root: current[0], levels }
}

const MERKLE_DEPTH = 32

/**
 * Compute the circomlib Merkle root over the given hex-encoded leaves,
 * padded to exactly 32 levels with Poseidon(root, 0).
 * Returns the root as a 64-char hex string.
 */
export async function computeCircomlibRoot(leaves: string[]): Promise<string> {
  if (leaves.length === 0) return '0'.repeat(64)

  const poseidon = await buildPoseidon()
  let level = leaves.map((h) => BigInt('0x' + h))
  let actualLevels = 0

  while (level.length > 1) {
    const next: bigint[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = i + 1 < level.length ? level[i + 1] : left
      next.push(poseidon([left, right]))
    }
    level = next
    actualLevels++
  }

  // Pad to 32 levels
  let root = level[0]
  for (let d = actualLevels; d < MERKLE_DEPTH; d++) {
    root = poseidon([root, 0n])
  }

  return root.toString(16).padStart(64, '0')
}
