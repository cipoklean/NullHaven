/**
 * End-to-end test: generate a proof and call verify() on the verifier contract.
 *
 * Usage: node scripts/test-verify.cjs [secret_hex]
 *   If no secret given, generates a random one and uses the first pool deposit.
 */

const { rpc, TransactionBuilder, BASE_FEE, Contract, Address, nativeToScVal, xdr, Keypair, StrKey } = require('@stellar/stellar-sdk')
const { readFileSync } = require('fs')
const { execSync } = require('child_process')
const { resolve } = require('path')

const FRONTEND_DIR = resolve(__dirname, '..')
const PROJECT_DIR = resolve(FRONTEND_DIR, '..')

// ─── Config ────────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = resolve(FRONTEND_DIR, '.env')
  const env = {}
  const content = readFileSync(envPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
  }
  return env
}

const env = loadEnv()
const RPC_URL = env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org'
const NETWORK = env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015'
const VERIFIER_ID = env.VITE_CONTRACT_VERIFIER
const POOL_ID = env.VITE_CONTRACT_POOL
const SECRET = env.STELLAR_SECRET

// ─── SnarkJS proof generation (via CLI) ────────────────────────────────────────

const CIRCUITS_DIR = resolve(FRONTEND_DIR, 'public', 'circuits')

function generateProof(secretHex, recipient, merkleRoot, aspRoot) {
  // Build input JSON for snarkjs
  const input = {
    secret: BigInt('0x' + secretHex).toString(),
    commitment: '0',
    nullifier: '0',
    recipient_lo: '0',
    recipient_hi: '0',
    root: BigInt('0x' + merkleRoot).toString(),
    merkle_siblings: Array(32).fill('0'),
    merkle_indices: Array(32).fill(0),
    asp_root: BigInt('0x' + aspRoot).toString(),
    asp_member_path: Array(32).fill('0'),
    asp_member_indices: Array(32).fill(0),
  }

  // We need to compute commitment and nullifier first
  // Use Node.js to compute Poseidon
  const { buildPoseidon } = require('./poseidon')

  // Actually, let's use the snarkjs fullProve directly in Node
  const snarkjs = require('snarkjs')
  const wasmPath = resolve(CIRCUITS_DIR, 'withdraw.wasm')
  const zkeyPath = resolve(CIRCUITS_DIR, 'withdraw_final.zkey')

  console.log('Computing Poseidon hashes...')
  // We'll need circomlibjs for Poseidon
  const { buildPoseidon } = require('circomlibjs')

  const main = async () => {
    const poseidon = await buildPoseidon()
    const secret = BigInt('0x' + secretHex)
    const commitment = poseidon([secret, 0n])
    const nullifier = poseidon([secret, 1n])

    // Decode recipient address
    let addrRaw
    if (recipient.startsWith('G')) {
      addrRaw = StrKey.decodeEd25519PublicKey(recipient)
    } else {
      addrRaw = StrKey.decodeContractId(recipient)
    }
    const recipientHi = BigInt('0x' + Array.from(addrRaw.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(''))
    const recipientLo = BigInt('0x' + Array.from(addrRaw.slice(16, 32)).map(b => b.toString(16).padStart(2, '0')).join(''))

    const circuitInputs = {
      secret: secret.toString(),
      commitment: commitment.toString(),
      nullifier: nullifier.toString(),
      recipient_lo: recipientLo.toString(),
      recipient_hi: recipientHi.toString(),
      root: BigInt('0x' + merkleRoot).toString(),
      merkle_siblings: Array(32).fill('0'),
      merkle_indices: Array(32).fill(0),
      asp_root: BigInt('0x' + aspRoot).toString(),
      asp_member_path: Array(32).fill('0'),
      asp_member_indices: Array(32).fill(0),
    }

    console.log('Generating proof (this may take a minute)...')
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, wasmPath, zkeyPath)

    return { proof, publicSignals }
  }

  return main()
}

// ─── Hex helpers ──────────────────────────────────────────────────────────────

function bnToHexBE(decStr, nBytes = 32) {
  return BigInt(decStr).toString(16).padStart(nBytes * 2, '0')
}

function bytesVal(hex, byteLen = 32) {
  return xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'))
}

function vecBytesVal(hexArr) {
  return xdr.ScVal.scvVec(hexArr.map(h => bytesVal(h, 32)))
}

function encodeG1(pt) {
  return bnToHexBE(pt[0], 32) + bnToHexBE(pt[1], 32)
}

function encodeG2(pt) {
  return bnToHexBE(pt[0][1], 32) + bnToHexBE(pt[0][0], 32) + bnToHexBE(pt[1][1], 32) + bnToHexBE(pt[1][0], 32)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const kp = Keypair.fromSecret(SECRET)
  const source = kp.publicKey()

  // Use a known test secret or the one provided
  const testSecret = process.argv[2] || '0000000000000000000000000000000000000000000000000000000000000001'
  const recipient = source  // withdraw to self

  // Fetch pool deposits for merkle root
  const rpcClient = new rpc.Server(RPC_URL)
  const contract = new Contract(POOL_ID)

  // Simulate next_idx and get_leaf
  async function simulate(op) {
    const account = await rpcClient.getAccount(source)
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE, networkPassphrase: NETWORK,
    }).addOperation(op).setTimeout(30).build()
    const res = await rpcClient.simulateTransaction(tx)
    if (rpc.Api.isSimulationError(res)) return null
    return res.result?.retval ?? null
  }

  const countVal = await simulate(contract.call('next_idx'))
  const count = countVal ? Number(countVal.value()) : 0
  console.log('Pool deposits:', count)

  if (count === 0) {
    console.log('No deposits in pool — nothing to withdraw')
    return
  }

  // Get first leaf
  const leafVal = await simulate(contract.call('get_leaf', nativeToScVal(0, { type: 'u32' })))
  const leafHex = Array.from(leafVal.value()).map(b => b.toString(16).padStart(2, '0')).join('')
  console.log('First leaf:', leafHex)

  // Get root
  const rootVal = await simulate(contract.call('root'))
  const rootHex = Array.from(rootVal.value()).map(b => b.toString(16).padStart(2, '0')).join('')
  console.log('Pool root:', rootHex)

  // Get ASP root
  const aspId = env.VITE_CONTRACT_ASP
  const aspContract = new Contract(aspId)
  const aspRootVal = await simulate(aspContract.call('root'))
  const aspRootHex = aspRootVal ? Array.from(aspRootVal.value()).map(b => b.toString(16).padStart(2, '0')).join('') : '0000000000000000000000000000000000000000000000000000000000000000'
  console.log('ASP root:', aspRootHex)

  console.log('\nGenerating test proof...')
  const { proof, publicSignals } = await generateProof(testSecret, recipient, rootHex, aspRootHex)

  const proofA = encodeG1(proof.pi_a)
  const proofB = encodeG2(proof.pi_b)
  const proofC = encodeG1(proof.pi_c)
  const pubInputs = publicSignals.map(s => bnToHexBE(s, 32))

  console.log('Proof generated. Calling verifier...')

  // Call verifier.verify(proof_a, proof_b, proof_c, public_inputs)
  const verifierContract = new Contract(VERIFIER_ID)
  const account = await rpcClient.getAccount(source)

  const op = verifierContract.call('verify',
    bytesVal(proofA, 64),
    bytesVal(proofB, 128),
    bytesVal(proofC, 64),
    vecBytesVal(pubInputs),
  )

  const baseTx = new TransactionBuilder(account, {
    fee: BASE_FEE, networkPassphrase: NETWORK,
  }).addOperation(op).setTimeout(60).build()

  console.log('Simulating...')
  const sim = await rpcClient.simulateTransaction(baseTx)

  if (rpc.Api.isSimulationError(sim)) {
    console.error('Simulation error:', sim.error)
    return
  }

  const result = sim.result.retval
  const verified = result.value()
  console.log('Verifier result:', verified ? '✅ PROOF VALID' : '❌ PROOF INVALID')

  if (verified) {
    console.log('\nPipeline is working end-to-end!')
    console.log('- WASM + zkey + verifier vkey are in sync')
    console.log('- The frontend should now work for withdrawals')
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
