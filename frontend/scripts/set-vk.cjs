/**
 * Update the verification key on the existing verifier contract.
 * Uses `set_vk` (admin-only) instead of `init` (one-time).
 *
 * Usage:
 *   node scripts/set-vk.cjs --dry-run   # simulate/prepare only
 *   node scripts/set-vk.cjs             # submit set_vk transaction
 */

const { rpc, TransactionBuilder, BASE_FEE, Contract, Address, xdr, nativeToScVal, Keypair } = require('@stellar/stellar-sdk');
const { readFileSync } = require('fs');

function loadEnv(path) {
  const out = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}

// ── Config ──────────────────────────────────────────────────────────────────────
const env = loadEnv(__dirname + '/../.env');
const STELLAR_SECRET = env.STELLAR_SECRET;
const RPC_URL         = env.VITE_RPC_URL         || 'https://soroban-testnet.stellar.org';
const NETWORK         = env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

const CONTRACT_ID = env.VITE_CONTRACT_VERIFIER;
// The admin keypair must match the one set during init.
const adminKp = Keypair.fromSecret(STELLAR_SECRET);

// ── Load new verification key ───────────────────────────────────────────────────
const vk = JSON.parse(readFileSync(__dirname + '/../public/circuits/verification_key.json', 'utf8'));

// ── Hex helpers (matching init-verifier.cjs) ───────────────────────────────────

function bnToHexBE(decStr, nBytes = 32) {
  return BigInt(decStr).toString(16).padStart(nBytes * 2, '0')
}

function bytesVal(hex, byteLen = 32) {
  return xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'))
}

function g1Point(point) {
  // point: [x, y, "1"] → 64-byte hex: x‖y
  return bnToHexBE(point[0], 32) + bnToHexBE(point[1], 32)
}

function g2Point(point) {
  // point: [[x_re, x_im], [y_re, y_im], ["1","0"]]
  // Output: x_im‖x_re‖y_im‖y_re (128 bytes hex)
  const x_re = bnToHexBE(point[0][0], 32)
  const x_im = bnToHexBE(point[0][1], 32)
  const y_re = bnToHexBE(point[1][0], 32)
  const y_im = bnToHexBE(point[1][1], 32)
  return x_im + x_re + y_im + y_re
}

// Build IC vector
const icEntries = [];
for (const icPt of vk.IC) {
  icEntries.push(bytesVal(g1Point(icPt), 64));
}
const icVec = xdr.ScVal.scvVec(icEntries);

// ── Build ScMap for set_vk:  VerifyingKey ──────────────────────────────────────
const vkMap = xdr.ScVal.scvMap([
  // Keys must be alphabetically sorted for Soroban host function compatibility
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('alpha_g1'), val: bytesVal(g1Point(vk.vk_alpha_1), 64) }),
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('beta_g2'),  val: bytesVal(g2Point(vk.vk_beta_2), 128) }),
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('delta_g2'), val: bytesVal(g2Point(vk.vk_delta_2), 128) }),
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('gamma_g2'), val: bytesVal(g2Point(vk.vk_gamma_2), 128) }),
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('ic'),       val: icVec }),
]);

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const server = new rpc.Server(RPC_URL, { allowHttp: true });
  const contract = new Contract(CONTRACT_ID);

  console.log('Updating vkey on verifier', CONTRACT_ID);
  console.log('Admin:', adminKp.publicKey());
  if (dryRun) console.log('Mode: dry-run — will not submit');

  const account = await server.getAccount(adminKp.publicKey());

  const op = contract.call('set_vk',
    nativeToScVal(Address.fromString(adminKp.publicKey()), { type: 'address' }),
    vkMap,                                       // vk: VerifyingKey
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  console.log('Simulation/preparation OK');
  if (dryRun) {
    console.log('Dry run complete. Re-run without --dry-run to submit set_vk.');
    return;
  }
  preparedTx.sign(adminKp);

  console.log('Submitting...');
  const sendResp = await server.sendTransaction(preparedTx);

  if (sendResp.status === 'ERROR') {
    console.error('ERROR:', JSON.stringify(sendResp, null, 2));
    process.exit(1);
  }

  console.log('TX hash:', sendResp.hash);
  console.log('Status:', sendResp.status);

  let result = sendResp;
  let polls = 0;
  while (polls < 15 && (result.status === 'PENDING' || result.status === 'TRY_AGAIN_LATER')) {
    await new Promise(r => setTimeout(r, 2000));
    result = await server.getTransaction(sendResp.hash);
    polls++;
  }

  if (result.status === 'SUCCESS') {
    console.log('Vkey updated successfully!');
  } else {
    console.log('Result:', JSON.stringify(result, null, 2));
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
