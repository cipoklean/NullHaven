/**
 * Check ASP contract state: allowlist root.
 */

const { rpc, TransactionBuilder, BASE_FEE, Contract, Keypair } = require('@stellar/stellar-sdk')
const { readFileSync } = require('fs')
const { resolve } = require('path')

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
const ASP_ID = 'CA5AVNUX5WBV5QNUXDU2MSHQ36ESDJD7OKG4ASK6KZDPHOD23GYZZQSY'

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

async function sim(op) {
  const rpcClient = new rpc.Server(RPC_URL)
  const account = await rpcClient.getAccount(source)
  const baseTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(op).setTimeout(60).build()

  const res = await rpcClient.simulateTransaction(baseTx)
  if (rpc.Api.isSimulationError(res)) {
    console.log('  Error:', typeof res.error === 'string' ? res.error : JSON.stringify(res.error).slice(0, 300))
    return null
  }
  return res.result?.retval ?? null
}

async function main() {
  const contract = new Contract(ASP_ID)
  console.log(`ASP: ${ASP_ID}`)

  // Try to query the root
  const rootVal = await sim(contract.call('root'))
  if (rootVal) {
    const hex = Array.from(rootVal.value()).map(b => b.toString(16).padStart(2, '0')).join('')
    console.log(`ASP root: ${hex}`)
  } else {
    console.log('Could not read ASP root — may need different function name')
  }

  // Try size / count
  const sizeVal = await sim(contract.call('size'))
  if (sizeVal) {
    console.log(`ASP size: ${sizeVal.value()}`)
  }

  // Try is_member for leaf 0 commitment
  const { xdr } = require('@stellar/stellar-sdk')
  const leaf0 = '2d2cc5e5af479fcef6443c246b893e03bdfd66f2a2484d4b8a0735ba73029f7e'
  function hexToU8(h) {
    const clean = h.replace(/^0x/i, '')
    return new Uint8Array(clean.length / 2).map((_, i) => parseInt(clean.slice(i*2, i*2+2), 16))
  }
  const leafOp = contract.call('is_member', xdr.ScVal.scvBytes(Buffer.from(hexToU8(leaf0))))
  const leafRes = await sim(leafOp)
  if (leafRes) {
    console.log(`is_member(leaf[0]): ${leafRes.value()}`)
  }
}

main().catch(e => console.error('Fatal:', e.message))
