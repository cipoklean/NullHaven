/**
 * Quick root fetcher for pool and ASP contracts.
 */

const { rpc, TransactionBuilder, BASE_FEE, Contract, Keypair } = require('@stellar/stellar-sdk')
const { readFileSync } = require('fs')

function loadEnv() {
  const env = {}
  const content = readFileSync('.env', 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  return env
}

async function main() {
  const env = loadEnv()
  const SECRET = env.STELLAR_SECRET
  const POOL = env.VITE_CONTRACT_POOL
  const ASP = env.VITE_CONTRACT_ASP
  const RPC_URL = env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org'
  const NETWORK = env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015'

  const kp = Keypair.fromSecret(SECRET)
  const s = new rpc.Server(RPC_URL)

  async function sim(contract, fn, ...args) {
    const acc = await s.getAccount(kp.publicKey())
    const op = contract.call(fn, ...args)
    const tx = new TransactionBuilder(acc, {
      fee: BASE_FEE, networkPassphrase: NETWORK,
    }).addOperation(op).setTimeout(30).build()
    const res = await s.simulateTransaction(tx)
    if (rpc.Api.isSimulationError(res)) {
      console.error('Sim error for', fn, ':', res.error)
      return null
    }
    return res.result.retval
  }

  function bytesToHex(rv) {
    if (!rv) return null
    try {
      return Array.from(rv.value()).map(b => b.toString(16).padStart(2, '0')).join('')
    } catch { return null }
  }

  const pool = new Contract(POOL)
  const asp = new Contract(ASP)

  const poolRoot = bytesToHex(await sim(pool, 'root'))
  const aspRoot = bytesToHex(await sim(asp, 'root'))
  const nextIdx = (await sim(pool, 'next_idx'))

  console.log('pool_root:', poolRoot)
  console.log('asp_root: ', aspRoot)
  console.log('next_idx: ', nextIdx ? nextIdx.value() : '?')
}

main().catch(e => console.error(e))
