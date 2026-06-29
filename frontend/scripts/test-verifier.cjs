/**
 * Quick test: verify the NullHaven verifier contract is properly initialized
 * by checking that calling verify() returns InputMismatch (not NotInit).
 *
 * Usage: node scripts/test-verifier.cjs
 */

const { rpc, TransactionBuilder, BASE_FEE, Contract, xdr, nativeToScVal, Keypair } = require('@stellar/stellar-sdk')
const { readFileSync } = require('fs')
const { resolve } = require('path')

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
const VERIFIER_ID = 'CC3STKWRFY4FHUEOBGJXAEHU5YIT3WLTLIMVMI646AUXMZWRBVMQB4KA'

const env = {}
readFileSync(resolve(__dirname, '..', '.env'), 'utf-8').split('\n').forEach(line => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) return
  env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
})

const secret = env.STELLAR_SECRET
const kp = Keypair.fromSecret(secret)
const source = kp.publicKey()

function hexToU8(hex) {
  const clean = hex.replace(/^0x/i, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2)
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16)
  return out
}

async function main() {
  const rpcClient = new rpc.Server(RPC_URL)

  // Dummy proof + 7 public inputs (wrong values, should cause InputMismatch)
  const zeros32 = '00'.repeat(32)
  const op = new Contract(VERIFIER_ID).call(
    'verify',
    xdr.ScVal.scvBytes(Buffer.from(hexToU8('00'.repeat(64)))),
    xdr.ScVal.scvBytes(Buffer.from(hexToU8('00'.repeat(128)))),
    xdr.ScVal.scvBytes(Buffer.from(hexToU8('00'.repeat(64)))),
    xdr.ScVal.scvVec(Array(7).fill(0).map(() =>
      xdr.ScVal.scvBytes(Buffer.from(hexToU8(zeros32)))
    )),
  )

  const account = await rpcClient.getAccount(source)
  const baseTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(op).setTimeout(60).build()

  console.log('Simulating verify() call to check init state...')
  const sim = await rpcClient.simulateTransaction(baseTx)

  if (rpc.Api.isSimulationError(sim)) {
    const errStr = typeof sim.error === 'string' ? sim.error : JSON.stringify(sim.error)
    if (errStr.includes('NotInit')) {
      console.log('❌ Verifier is NOT initialized (NotInit error)')
    } else if (errStr.includes('InputMismatch')) {
      console.log('✅ Verifier IS initialized! (InputMismatch — expected with dummy inputs)')
    } else {
      console.log('⚠ Unknown error:', errStr)
    }
  } else {
    // If simulation succeeds, the pairing check passed (very unlikely with dummy inputs)
    console.log('⚠ Simulation succeeded with dummy inputs — unexpected')
  }
}

main().catch(e => console.error('Fatal:', e.message))
