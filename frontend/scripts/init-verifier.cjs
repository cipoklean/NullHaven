/**
 * Initialize the Groth16 verifier contract on testnet.
 *
 * Usage: node scripts/init-verifier.cjs [--dry-run]
 */

const { rpc, TransactionBuilder, BASE_FEE, Contract, Address, xdr, nativeToScVal, Keypair } = require('@stellar/stellar-sdk')
const { readFileSync } = require('fs')
const { resolve } = require('path')

const FRONTEND_DIR = resolve(__dirname, '..')
const PROJECT_DIR = resolve(FRONTEND_DIR, '..')
const CIRCUITS_DIR = resolve(PROJECT_DIR, 'circuits')

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
const VERIFIER_ID = 'CC3STKWRFY4FHUEOBGJXAEHU5YIT3WLTLIMVMI646AUXMZWRBVMQB4KA'

// ─── Load env ─────────────────────────────────────────────────────────────────

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

// ─── Hex helpers ─────────────────────────────────────────────────────────────

function hexToU8(hex, byteLen = 32) {
  const clean = hex.replace(/^0x/i, '').padStart(byteLen * 2, '0')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16)
  }
  return out
}

function bytesVal(hex, byteLen = 32) {
  return xdr.ScVal.scvBytes(Buffer.from(hexToU8(hex, byteLen)))
}

function vecBytesVal(hexArr, byteLen = 32) {
  return xdr.ScVal.scvVec(hexArr.map((h) => bytesVal(h, byteLen)))
}

// ─── VKey conversion ─────────────────────────────────────────────────────────

function bnToHexBE(decStr, nBytes = 32) {
  return BigInt(decStr).toString(16).padStart(nBytes * 2, '0')
}

function g1Point(point) {
  return bnToHexBE(point[0], 32) + bnToHexBE(point[1], 32)
}

function g2Point(point) {
  const x_c1 = bnToHexBE(point[0][0], 32)
  const x_c0 = bnToHexBE(point[0][1], 32)
  const y_c1 = bnToHexBE(point[1][0], 32)
  const y_c0 = bnToHexBE(point[1][1], 32)
  return x_c1 + x_c0 + y_c1 + y_c0
}

function buildVkScVal(vk) {
  const entries = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('alpha_g1'),
      val: bytesVal(g1Point(vk.vk_alpha_1), 64),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('beta_g2'),
      val: bytesVal(g2Point(vk.vk_beta_2), 128),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('delta_g2'),
      val: bytesVal(g2Point(vk.vk_delta_2), 128),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('gamma_g2'),
      val: bytesVal(g2Point(vk.vk_gamma_2), 128),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ic'),
      val: vecBytesVal(vk.IC.map(g1Point), 64),
    }),
  ]
  return xdr.ScVal.scvMap(entries)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const env = loadEnv()
  const secret = env.STELLAR_SECRET

  if (!secret || secret.length !== 56) {
    console.error('ERROR: STELLAR_SECRET not found or invalid in frontend/.env')
    process.exit(1)
  }

  const kp = Keypair.fromSecret(secret)
  const source = kp.publicKey()
  console.log(`Source: ${source}`)
  console.log(`Verifier: ${VERIFIER_ID}`)

  // Load vkey
  const vkPath = resolve(CIRCUITS_DIR, 'verification_key.json')
  const vk = JSON.parse(readFileSync(vkPath, 'utf-8'))
  console.log(`VKey: nPublic=${vk.nPublic}, IC entries=${vk.IC.length}`)

  // Build the vk ScVal
  const vkScVal = buildVkScVal(vk)
  console.log(`VKey XDR size: ${vkScVal.toXDR().length} bytes`)

  if (dryRun) {
    console.log('\n[Dry run] Would call init(admin, vk) on verifier')
    const xdrBase64 = vkScVal.toXDR('base64')
    console.log('VKey XDR (base64):', xdrBase64.slice(0, 100) + '...')
    return
  }

  // Build operation
  const rpcClient = new rpc.Server(RPC_URL)
  const op = new Contract(VERIFIER_ID).call(
    'init',
    nativeToScVal(Address.fromString(source), { type: 'address' }),
    vkScVal,
  )

  // Build base tx
  const account = await rpcClient.getAccount(source)
  const baseTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build()

  // Simulate
  console.log('\nSimulating...')
  const sim = await rpcClient.simulateTransaction(baseTx)
  if (rpc.Api.isSimulationError(sim)) {
    const err = sim.error
    console.error('Simulation error:', err)
    process.exit(1)
  }
  console.log('Simulation OK')
  console.log('Resource cost:', JSON.stringify(sim.cost))

  // Assemble
  const prepared = rpc.assembleTransaction(baseTx, sim).build()

  // Sign
  prepared.sign(kp)

  // Send
  console.log('Sending...')
  const sendRes = await rpcClient.sendTransaction(prepared)
  if (sendRes.status === 'ERROR') {
    console.error('Send error:', JSON.stringify(sendRes.errorResult))
    process.exit(1)
  }

  console.log(`TX hash: ${sendRes.hash}`)

  // Wait for confirmation
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const status = await rpcClient.getTransaction(sendRes.hash)
    if (status.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      console.log(`\n✅ Verifier initialized successfully!`)
      console.log(`TX: ${sendRes.hash}`)
      return
    }
    if (status.status === rpc.Api.GetTransactionStatus.FAILED) {
      console.error(`\n❌ TX failed on-chain: ${sendRes.hash}`)
      const resXdr = status.resultXdr
      console.error('Result XDR:', resXdr?.toXDR?.('base64') || resXdr)
      process.exit(1)
    }
    process.stdout.write('.')
  }
  console.error(`\n❌ Timeout waiting for confirmation`)
  process.exit(1)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
