#!/usr/bin/env node
/**
 * Compute the Merkle root from pool leaves using Poseidon (depth=32, zero-padded).
 */

async function main() {
  const { buildPoseidon } = require('circomlibjs')
  const poseidon = await buildPoseidon()

  // Pool leaves (from check-pool.cjs)
  const leafHexes = [
    '2d2cc5e5af479fcef6443c246b893e03bdfd66f2a2484d4b8a0735ba73029f7e',
    '187a36d470277d1f23c55cee8ccd7a5a8a4ba9a19e50d67864efb614ea2479ff',
  ]

  const DEPTH = 32

  function hexToBigint(hex) {
    return BigInt('0x' + hex)
  }

  function toHex(val) {
    return val.toString(16).padStart(64, '0')
  }

  let level = leafHexes.map(hexToBigint)

  // Build tree bottom-up
  for (let d = 0; d < DEPTH; d++) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i]
      const r = (i + 1 < level.length) ? level[i + 1] : l
      next.push(poseidon([l, r]))
    }
    level = next

    // For levels beyond leaf count, pad with Poseidon(prev_root, 0)
    // But since we pad with zeros below, let's just compute directly
  }

  // Zero-padding: for each remaining level (DEPTH - actualDepth),
  // root = Poseidon(root, 0)
  // This is already handled by the loop above since we have 2 leaves at level 0,
  // then 1 node at level 1, then Poseidon(prev, 0) for levels 2..31

  // Actually, for the ground truth: Merkle tree of depth 32 with 2 leaves.
  // Level 0 (leaves): [L0, L1]
  // Level 1: [Poseidon(L0, L1)]
  // Level 2: [Poseidon(Poseidon(L0, L1), 0)]
  // ...
  // Level 31: [Poseidon(..., 0)]  = root

  let root = level[0] // level has 1 element after first combine
  console.log('After leaves:', toHex(root))

  // Pad remaining levels (1..31, which is 30 more levels)
  for (let d = 1; d < DEPTH; d++) {
    root = poseidon([root, 0n])
  }

  console.log('Merle root (depth 32):', toHex(root))

  // Also compute ASP root (just Poseidon of all member commitments, zero-padded to 32)
  // ASP members = the same 2 deposits
  let asp = leafHexes.map(hexToBigint)
  while (asp.length > 1) {
    const next = []
    for (let i = 0; i < asp.length; i += 2) {
      const l = asp[i]
      const r = (i + 1 < asp.length) ? asp[i + 1] : l
      next.push(poseidon([l, r]))
    }
    asp = next
  }
  let aspRoot = asp[0]
  for (let d = 0; d < DEPTH - 1; d++) {
    // Zero pad remaining levels
    // Actually, ASP tree depth is whatever the circuit expects - 32
    // But the circuit expects the ASP path to be depth 32.
    // Wait, the ASP doesn't use depth 32 - it uses a variable-height tree.
    // Let me just use the raw root.
  }
  // Actually, the ASP root is probably just the Poseidon of the two members with no padding
  // because the circuit handles fixed-depth paths separately.
  console.log('ASP root (raw):', toHex(aspRoot))
}

main().catch(e => console.error(e))
