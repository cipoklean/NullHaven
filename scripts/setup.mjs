#!/usr/bin/env node

console.log(`
╔══════════════════════════════════════════════════════════╗
║             StellarShield - Setup Script                ║
║    Compliant Privacy Pools on Stellar (Soroban)         ║
╚══════════════════════════════════════════════════════════╝
`)

const steps = [
  ['Checking Rust toolchain...', 'rustc --version && cargo --version'],
  ['Adding wasm target...', 'rustup target add wasm32-unknown-unknown'],
  ['Building Soroban contracts...', 'cd contracts && cargo build --target wasm32-unknown-unknown --release'],
  ['Installing frontend deps...', 'cd frontend && npm install'],
  ['Building frontend...', 'cd frontend && npm run build'],
  ['Done!', ''],
]

async function run() {
  const { execSync } = await import('child_process')

  for (const [msg, cmd] of steps) {
    console.log(`▶ ${msg}`)
    if (cmd) {
      try {
        execSync(cmd, { stdio: 'inherit', shell: true })
      } catch (e) {
        console.error(`  ✗ Failed: ${e.message}`)
      }
    }
    console.log('')
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║             Setup Complete!                              ║
║                                                          ║
║   Next steps:                                            ║
║   1. Deploy contracts to Stellar testnet:                ║
║      npm run contracts:deploy                            ║
║                                                          ║
║   2. Start the frontend:                                 ║
║      npm run frontend                                    ║
║                                                          ║
║   3. Configure contract addresses in:                   ║
║      frontend/src/config/index.ts                        ║
║                                                          ║
║   4. Build ZK circuits:                                  ║
║      npm run circuits:build                              ║
╚══════════════════════════════════════════════════════════╝
  `)
}

run().catch(console.error)
