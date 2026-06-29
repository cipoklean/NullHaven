/**
 * Check pool state: number of deposits and list of commitments.
 */

const { rpc, TransactionBuilder, BASE_FEE, Contract, xdr, nativeToScVal, Keypair } = require('@stellar/stellar-sdk')
const { readFileSync } = require('fs')
const { resolve } = require('path')

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
const POOL_ID = 'CBGDOFHUJ5HWOPBDFF3MJWP3ZF6MEXUQDSIZLFTRCIZ2LZJ5J6L7T36I'

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

function hexFromBytes(bytes) {
  if (!bytes || bytes.length === 0) return null
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sim(op) {
  const rpcClient = new rpc.Server(RPC_URL)
  const account = await rpcClient.getAccount(source)
  const baseTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(op).setTimeout(60).build()

  const res = await rpcClient.simulateTransaction(baseTx)
  if (rpc.Api.isSimulationError(res)) {
    console.log('  Simulation error:', typeof res.error === 'string' ? res.error : JSON.stringify(res.error).slice(0, 200))
    return null
  }
  return res.result?.retval ?? null
}

async function main() {
  const contract = new Contract(POOL_ID)

  // Get next_idx
  console.log('=== Pool State ===')
  const countVal = await sim(contract.call('next_idx'))
  const count = countVal ? Number(countVal.value()) : 0
  console.log(`Deposits: ${count}`)

  if (count === 0) {
    console.log('No deposits in pool yet.')
    return
  }

  // List commitments
  for (let i = 0; i < count; i++) {
    const leafVal = await sim(contract.call('get_leaf', nativeToScVal(i, { type: 'u32' })))
    if (leafVal && leafVal.switch().name !== 'scvVoid') {
      const hex = hexFromBytes(leafVal.value())
      console.log(`  Leaf[${i}]: ${hex}`)
    }
  }
}

main().catch(e => console.error('Fatal:', e.message))
