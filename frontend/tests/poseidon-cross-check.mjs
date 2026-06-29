#!/usr/bin/env node
// ============================================================================
// NullHaven — Poseidon Cross-Validation Test
// ============================================================================
// Verifies that circomlibjs (JS) Poseidon produces the same digest as the
// Rust pool contract for the known test vector:
//   poseidon([1, 2]) == 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a
//
// This MUST pass before deploying — a mismatch means deposits/withdrawals break.
// ============================================================================

const EXPECTED = '115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a'

async function main() {
  console.log('Cross-validating JS Poseidon vs Rust pool contract...\n')

  // Dynamically import circomlibjs (ESM)
  const { buildPoseidon } = await import('circomlibjs')
  const p = await buildPoseidon()

  // Test vector: poseidon([1, 2])
  const result = p([1n, 2n])
  const hex    = p.F.toObject(result).toString(16).padStart(64, '0')

  if (hex !== EXPECTED) {
    console.error(`  FAIL — JS: 0x${hex}`)
    console.error(`         Rust: 0x${EXPECTED}`)
    console.error('\n  The JS and Rust Poseidon implementations do NOT match.')
    console.error('  This will cause deposit commitments and withdrawal proofs to fail on-chain.')
    process.exit(1)
  }

  console.log('  PASS — JS and Rust Poseidon produce identical digests ✓')
  console.log(`         poseidon([1, 2]) = 0x${hex}`)

  // Extra: verify consistency (roundtrip property)
  const h_ab = p.F.toObject(p([1n, 2n]))
  const h_ba = p.F.toObject(p([2n, 1n]))
  if (h_ab === h_ba) {
    console.error('\n  FAIL — Poseidon is commutative! Merkle tree security is broken.')
    process.exit(1)
  }
  console.log('  PASS — Poseidon is non-commutative (required for Merkle trees) ✓')

  // Extra: verify deterministic (must convert field elements to bigint first)
  const r1 = p.F.toObject(p([42n, 99n]))
  const r2 = p.F.toObject(p([42n, 99n]))
  if (r1 !== r2) {
    console.error('\n  FAIL — Poseidon is non-deterministic!')
    process.exit(1)
  }
  console.log('  PASS — Poseidon is deterministic ✓')

  console.log('\n════ All checks passed — Poseidon JS ↔ Rust compatibility verified ════')
}

main().catch((e) => {
  console.error('Error running cross-validation:', e.message)
  console.error('Did you run `npm install` in the project root?')
  process.exit(1)
})
