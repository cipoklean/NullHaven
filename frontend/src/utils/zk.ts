import { groth16 } from 'snarkjs'
import { Address } from '@stellar/stellar-sdk'
import { buildPoseidon } from './circuits'
import { CIRCUIT_WASM_URL, CIRCUIT_ZKEY_URL } from '../config'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZKProof {
  proofA: string        // hex-encoded G1 point (64 bytes)
  proofB: string        // hex-encoded G2 point (128 bytes)
  proofC: string        // hex-encoded G1 point (64 bytes)
  publicInputs: string[] // hex-encoded field elements (32 bytes each)
}

export interface DepositNote {
  secret:     string  // hex 31-byte random scalar — SAVE OFFLINE, never share
  commitment: string  // hex Poseidon(secret, 0) — stored on-chain
  nullifier:  string  // hex Poseidon(secret, 1) — burned on withdrawal
}

export interface MerkleProof {
  path:    string[]   // sibling hashes, leaf→root order
  indices: number[]   // 0 = current node is left child, 1 = right child
  root:    string     // hex Merkle root
}

// ─── BN254 scalar field modulus ───────────────────────────────────────────────
const BN254_P = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n)
  crypto.getRandomValues(arr)
  return arr
}

export function toHex(src: Uint8Array | bigint, byteLen = 32): string {
  if (typeof src === 'bigint') {
    return src.toString(16).padStart(byteLen * 2, '0')
  }
  return Array.from(src)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBigint(hex: string): bigint {
  const clean = hex.replace(/^0x/i, '').padStart(2, '0')
  return BigInt('0x' + clean)
}

// ─── Deposit note ─────────────────────────────────────────────────────────────

/**
 * Generate a new deposit note.
 * The caller MUST store `secret` offline — it is the only withdrawal key.
 * commitment = Poseidon(secret, 0) is submitted on-chain.
 * nullifier  = Poseidon(secret, 1) is revealed only on withdrawal.
 */
export async function createDepositNote(): Promise<DepositNote> {
  const poseidon = await buildPoseidon()

  // 31 bytes keeps the value safely below BN254_P (< 2^248 < 2^254)
  let secretBigint: bigint
  do {
    secretBigint = hexToBigint(toHex(randomBytes(31), 31))
  } while (secretBigint >= BN254_P)

  const commitment = poseidon([secretBigint, 0n])
  const nullifier  = poseidon([secretBigint, 1n])

  return {
    secret:     toHex(secretBigint, 32),
    commitment: toHex(commitment, 32),
    nullifier:  toHex(nullifier, 32),
  }
}

/** Re-derive commitment + nullifier from a saved secret (for withdrawal UI). */
export async function deriveFromSecret(
  secretHex: string,
): Promise<{ commitment: string; nullifier: string }> {
  const poseidon = await buildPoseidon()
  const secret   = hexToBigint(secretHex)
  return {
    commitment: toHex(poseidon([secret, 0n]), 32),
    nullifier:  toHex(poseidon([secret, 1n]), 32),
  }
}

// ─── Merkle proof ─────────────────────────────────────────────────────────────

const MERKLE_DEPTH = 32

/**
 * Build a Merkle inclusion proof, padded to exactly MERKLE_DEPTH (32) levels
 * to match the circuit's MerkleTreeInclusion. Padding uses sibling=0, index=0
 * which produces Poseidon(prev, 0) — the circuit's zero-padding convention.
 */
export async function generateMerkleProof(
  leaves: string[],
  leafIndex: number,
): Promise<MerkleProof> {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new RangeError(`leafIndex ${leafIndex} out of range [0, ${leaves.length})`)
  }

  const poseidon = await buildPoseidon()
  const path: string[]    = []
  const indices: number[] = []
  let idx   = leafIndex
  let level = leaves.map(hexToBigint)

  while (level.length > 1) {
    const isLeft  = idx % 2 === 0
    const sibIdx  = isLeft ? idx + 1 : idx - 1
    const sibling = sibIdx < level.length ? level[sibIdx] : level[idx]
    path.push(toHex(sibling, 32))
    indices.push(isLeft ? 0 : 1)
    idx = Math.floor(idx / 2)

    const next: bigint[] = []
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i]
      const r = i + 1 < level.length ? level[i + 1] : l
      next.push(poseidon([l, r]))
    }
    level = next
  }

  // Pad path/indices to exactly 32 levels — matches circuit zero-padding convention
  const actualDepth = path.length
  while (path.length < MERKLE_DEPTH) {
    path.push('0'.padStart(64, '0'))
    indices.push(0)
  }

  // Pad the root: for each remaining level, Poseidon(prev, 0)
  let paddedRoot = level[0]
  for (let i = actualDepth; i < MERKLE_DEPTH; i++) {
    paddedRoot = poseidon([paddedRoot, 0n])
  }

  return { path, indices, root: toHex(paddedRoot, 32) }
}

// ─── Groth16 proof generation ─────────────────────────────────────────────────

export interface WithdrawInputs {
  secretHex:   string
  recipient:   string    // Stellar G-address
  merkleProof: MerkleProof
  aspPath:     string[]  // ASP allowlist Merkle siblings
  aspIndices:  number[]
  aspRoot:     string
}

const DEPTH = 32

function padTo<T>(arr: T[], zero: T): T[] {
  return arr.length >= DEPTH
    ? arr.slice(0, DEPTH)
    : [...arr, ...Array(DEPTH - arr.length).fill(zero)]
}

function encodeG1(pt: string[]): string {
  return (
    BigInt(pt[0]).toString(16).padStart(64, '0') +
    BigInt(pt[1]).toString(16).padStart(64, '0')
  )
}

function encodeG2(pt: string[][]): string {
  // snarkjs stores G2 as [[x_c0, x_c1], [y_c0, y_c1]] where c0=real, c1=imag.
  // The Soroban BN254 verifier expects x_im‖x_re‖y_im‖y_re (imag first),
  // matching the Ethereum EIP-197 convention and the VK loading script.
  // Swap [0]↔[1] within each pair to put imaginary first.
  return (
    BigInt(pt[0][1]).toString(16).padStart(64, '0') +
    BigInt(pt[0][0]).toString(16).padStart(64, '0') +
    BigInt(pt[1][1]).toString(16).padStart(64, '0') +
    BigInt(pt[1][0]).toString(16).padStart(64, '0')
  )
}

/**
 * Generate a real Groth16 proof in the browser via snarkjs.
 * Circuit WASM + zkey must be built and placed in /public/circuits/.
 * See config/index.ts for the expected file paths.
 */
export async function generateWithdrawProof(
  inputs: WithdrawInputs,
): Promise<ZKProof> {
  const poseidon  = await buildPoseidon()
  const secret    = hexToBigint(inputs.secretHex)
  const commitment = poseidon([secret, 0n])
  const nullifier  = poseidon([secret, 1n])

  // Decode Stellar address using XDR encoding to match the contract's
  // address_to_bytes32() extraction (bytes 8..39 of the ScVal XDR).
  //
  // For account addresses (G...), AccountID is a PublicKey union which has its
  // own 4-byte discriminant, so the XDR is 44 bytes:
  //   [0..4) ScVal tag  [4..8) ScAddress disc  [8..12) PubKey disc  [12..44) key
  // The contract reads bytes 8..39, which includes the PubKey discriminant
  // (4 zero bytes) + the first 28 bytes of the key.
  //
  // For contract addresses (C...), the XDR is 40 bytes and bytes 8..39 are
  // the full 32-byte ContractID.
  //
  // IMPORTANT: We must use the same byte extraction as the deployed contract,
  // even though offset 12 would be more correct for account addresses.
  const scVal = Address.fromString(inputs.recipient).toScVal()
  const xdrBytes = scVal.toXDR()
  const addrRaw = new Uint8Array(xdrBytes.slice(8, 40))

  // Split 32-byte value into two 16-byte halves for BN254 field elements.
  const recipientHi = hexToBigint(
    Array.from(addrRaw.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  )
  const recipientLo = hexToBigint(
    Array.from(addrRaw.slice(16, 32))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  )

  const circuitInputs = {
    secret:             secret.toString(),
    commitment:         commitment.toString(),
    nullifier:          nullifier.toString(),
    recipient_lo:       recipientLo.toString(),
    recipient_hi:       recipientHi.toString(),
    root:               hexToBigint(inputs.merkleProof.root).toString(),
    merkle_siblings:    padTo(inputs.merkleProof.path.map((h) => hexToBigint(h).toString()), '0'),
    merkle_indices:     padTo(inputs.merkleProof.indices, 0),
    asp_root:           hexToBigint(inputs.aspRoot).toString(),
    asp_member_path:    padTo(inputs.aspPath.map((h) => hexToBigint(h).toString()), '0'),
    asp_member_indices: padTo(inputs.aspIndices, 0),
  }

  const { proof, publicSignals } = await groth16.fullProve(
    circuitInputs,
    CIRCUIT_WASM_URL,
    CIRCUIT_ZKEY_URL,
  )

  return {
    proofA:       encodeG1(proof.pi_a as string[]),
    proofB:       encodeG2(proof.pi_b as string[][]),
    proofC:       encodeG1(proof.pi_c as string[]),
    publicInputs: (publicSignals as string[]).map(
      (s) => BigInt(s).toString(16).padStart(64, '0'),
    ),
  }
}
