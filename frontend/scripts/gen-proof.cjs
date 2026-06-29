#!/usr/bin/env node
/**
 * Step 1: Generate a Groth16 proof for withdraw via snarkjs CLI.
 *
 * Output: proof.json (pi_a, pi_b, pi_c, publicSignals)
 *
 * Usage: node scripts/gen-proof.cjs <secret_hex> <recipient_addr> <merkle_root> <asp_root>
 */

const { execSync } = require('child_process')
const { readFileSync, writeFileSync, mkdirSync } = require('fs')
const { resolve, join } = require('path')

const FRONTEND = resolve(__dirname, '..')
const CIRCUITS = resolve(FRONTEND, 'public', 'circuits')
const TMP = resolve(FRONTEND, '.test-tmp')

// ─── Poseidon via circomlibjs ──────────────────────────────────────────────────

async function buildPoseidon() {
  // Use the full path to circomlibjs
  const circomlibjs = require('circomlibjs')
  return circomlibjs.buildPoseidon()
}

function toHex(val, bytes = 32) {
  return val.toString(16).padStart(bytes * 2, '0')
}

function hexToBigint(hex) {
  return BigInt('0x' + hex.replace(/^0x/, ''))
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length < 4) {
    console.log('Usage: node scripts/gen-proof.cjs <secret_hex> <recipient_G_addr> <merkle_root_hex> <asp_root_hex>')
    console.log('Uses test defaults for merkle/ASP paths (zeros)')
    process.exit(1)
  }

  const [secretHex, recipient, merkleRoot, aspRoot] = args

  console.log('Building Poseidon...')
  const poseidon = await buildPoseidon()

  const secret = hexToBigint(secretHex)
  const commitment = poseidon([secret, 0n])
  const nullifier = poseidon([secret, 1n])
  console.log('Secret:     ', secretHex)
  console.log('Commitment: ', toHex(commitment))
  console.log('Nullifier:  ', toHex(nullifier))

  // Decode Stellar address
  const { StrKey } = require('@stellar/stellar-sdk')
  let addrRaw
  if (recipient.startsWith('G')) {
    addrRaw = StrKey.decodeEd25519PublicKey(recipient)
  } else if (recipient.startsWith('C')) {
    addrRaw = StrKey.decodeContractId(recipient)
  } else {
    console.error('Unknown address type:', recipient)
    process.exit(1)
  }

  const recipientHi = hexToBigint(
    Array.from(addrRaw.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')
  )
  const recipientLo = hexToBigint(
    Array.from(addrRaw.slice(16, 32)).map(b => b.toString(16).padStart(2, '0')).join('')
  )
  console.log('Recipient hi:', recipientHi.toString())
  console.log('Recipient lo:', recipientLo.toString())

  // Build circuit inputs
  const circuitInputs = {
    secret: secret.toString(),
    commitment: commitment.toString(),
    nullifier: nullifier.toString(),
    recipient_lo: recipientLo.toString(),
    recipient_hi: recipientHi.toString(),
    root: hexToBigint(merkleRoot).toString(),
    merkle_siblings: Array(32).fill('0'),
    merkle_indices: Array(32).fill(0),
    asp_root: hexToBigint(aspRoot).toString(),
    asp_member_path: Array(32).fill('0'),
    asp_member_indices: Array(32).fill(0),
  }

  // Write input.json
  mkdirSync(TMP, { recursive: true })
  const inputPath = join(TMP, 'input.json')
  writeFileSync(inputPath, JSON.stringify(circuitInputs, null, 2))
  console.log('Input written to', inputPath)

  // Run snarkjs
  const wasmPath = join(CIRCUITS, 'withdraw.wasm')
  const zkeyPath = join(CIRCUITS, 'withdraw_final.zkey')
  const witnessPath = join(TMP, 'witness.wtns')
  const proofPath = join(TMP, 'proof.json')
  const publicPath = join(TMP, 'public.json')

  console.log('\nGenerating witness...')
  execSync(`npx snarkjs wtns calculate ${wasmPath} ${inputPath} ${witnessPath}`, {
    cwd: FRONTEND, stdio: 'inherit', timeout: 120000,
  })

  console.log('Generating proof...')
  execSync(`npx snarkjs groth16 prove ${zkeyPath} ${witnessPath} ${proofPath} ${publicPath}`, {
    cwd: FRONTEND, stdio: 'inherit', timeout: 120000,
  })

  console.log('\nVerifying locally...')
  const vkeyPath = join(CIRCUITS, 'verification_key.json')
  execSync(`npx snarkjs groth16 verify ${vkeyPath} ${publicPath} ${proofPath}`, {
    cwd: FRONTEND, stdio: 'inherit', timeout: 30000,
  })

  // Read results
  const proof = JSON.parse(readFileSync(proofPath, 'utf8'))
  const publicSignals = JSON.parse(readFileSync(publicPath, 'utf8'))

  console.log('\n--- Proof (hex) ---')
  const encodeG1 = (pt) => toHex(BigInt(pt[0])) + toHex(BigInt(pt[1]))
  const encodeG2 = (pt) => toHex(BigInt(pt[0][1])) + toHex(BigInt(pt[0][0])) + toHex(BigInt(pt[1][1])) + toHex(BigInt(pt[1][0]))

  const result = {
    proofA: encodeG1(proof.pi_a),
    proofB: encodeG2(proof.pi_b),
    proofC: encodeG1(proof.pi_c),
    publicInputs: publicSignals.map(s => toHex(BigInt(s))),
  }

  console.log(JSON.stringify(result, null, 2))

  // Save for step 2
  const resultPath = join(TMP, 'verify-input.json')
  writeFileSync(resultPath, JSON.stringify(result, null, 2))
  console.log('\nSaved to', resultPath)
  console.log('Run: node scripts/verify-onchain.cjs')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
