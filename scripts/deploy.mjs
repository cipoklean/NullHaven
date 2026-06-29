#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const WASM_DIR = resolve(root, 'contracts', 'target', 'wasm32v1-none', 'release');

const CONTRACTS = [
  { name: 'ASP Contract',               wasm: 'asp_contract.wasm' },
  { name: 'Groth16 Verifier',           wasm: 'groth16_verifier.wasm' },
  { name: 'Compliance Registry',        wasm: 'compliance_registry.wasm' },
  { name: 'NullHaven Pool',             wasm: 'nullhaven_pool.wasm' },
];

const STELLAR_SECRET = process.env.STELLAR_SECRET;
const NETWORK = process.env.STELLAR_NETWORK || 'testnet';

function stellar(...args) {
  const cmd = ['stellar', ...args].join(' ');
  return execSync(cmd, { encoding: 'utf-8', shell: true }).trim();
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║        NullHaven — Contract Deployment Script           ║
╚══════════════════════════════════════════════════════════╝
`);
  if (!STELLAR_SECRET) {
    console.error('✗ STELLAR_SECRET environment variable not set.');
    console.error('  Set it to your Stellar testnet secret key (starts with S...)');
    console.error('  Example: export STELLAR_SECRET=SCYOURKEYHERE');
    process.exit(1);
  }

  console.log(`Network:  ${NETWORK}`);
  console.log(`Source:   ${STELLAR_SECRET.slice(0, 4)}...${STELLAR_SECRET.slice(-4)}`);
  console.log(`WASM dir: ${WASM_DIR}\n`);

  const deployed = {};

  for (const { name, wasm } of CONTRACTS) {
    const wasmPath = resolve(WASM_DIR, wasm);
    if (!existsSync(wasmPath)) {
      console.error(`  ✗ ${name}: WASM not found at ${wasmPath}`);
      console.error('    Build contracts first: cd contracts && cargo build --target wasm32v1-none --release');
      continue;
    }

    process.stdout.write(`  ▶ Deploying ${name}... `);
    try {
      const contractId = stellar(
        'contract', 'deploy',
        '--wasm', wasmPath,
        '--source-account', STELLAR_SECRET,
        '--network', NETWORK,
      );
      deployed[name] = contractId;
      console.log(`✓ ${contractId}`);
    } catch (e) {
      console.error(`\n    ✗ Failed: ${e.stderr || e.message}`);
    }
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Deployed Contract Addresses:');
  console.log('──────────────────────────────────────────────────────────');
  for (const [name, id] of Object.entries(deployed)) {
    console.log(`  ${name.padEnd(25)} ${id}`);
  }
  console.log('\n  Update these in: frontend/src/config/index.ts');
  console.log('══════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('Deployment failed:', e.message);
  process.exit(1);
});
