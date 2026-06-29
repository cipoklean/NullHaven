// ─── Network config ─────────────────────────────────────────────────────────
// Defaults to Testnet; override via .env (copy .env.example → .env)
export const NETWORK_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015'

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ?? 'https://soroban-testnet.stellar.org'

export const HORIZON_URL =
  import.meta.env.VITE_HORIZON_URL ?? 'https://horizon-testnet.stellar.org'

// ─── Deployed contract addresses ────────────────────────────────────────────
// Set these in your .env file after deploying to testnet
export const CONTRACTS = {
  pool:       import.meta.env.VITE_CONTRACT_POOL       ?? '',
  verifier:   import.meta.env.VITE_CONTRACT_VERIFIER   ?? '',
  asp:        import.meta.env.VITE_CONTRACT_ASP        ?? '',
  compliance: import.meta.env.VITE_CONTRACT_COMPLIANCE ?? '',
}

/** Get a contract address or throw a clear error if not configured. */
export function getContract(name: keyof typeof CONTRACTS): string {
  const addr = CONTRACTS[name]
  if (!addr) {
    throw new Error(
      `Contract "${name}" not configured. Set VITE_CONTRACT_${name.toUpperCase()} in .env ` +
      `(copy .env.example → .env). Did you run the deployment script?`
    )
  }
  return addr
}

// ─── Fixed note denomination ─────────────────────────────────────────────────
// 10_000_000 stroops = 1 XLM. Must match DENOMINATION constant in pool contract.
export const DENOMINATION = 10_000_000n

// ─── ZK circuit artifacts ────────────────────────────────────────────────────
// Place compiled circuit files in /public/circuits/ after running:
//   cd circuits && circom withdraw.circom --r1cs --wasm --sym
//   snarkjs groth16 setup withdraw.r1cs pot12_final.ptau withdraw_0000.zkey
//   snarkjs zkey contribute withdraw_0000.zkey withdraw_final.zkey
//   snarkjs zkey export verificationkey withdraw_final.zkey verification_key.json
//
// IMPORTANT: The ASP Merkle tree must be built CLIENT-SIDE and its root set on-chain
// via the Pool.set_asp_root() admin function. The circuit proves the depositor's
// commitment is in the ASP tree; the contract then verifies the ASP root matches
// the on-chain stored value. Without a valid ASP tree, all withdrawals will fail.
export const CIRCUIT_WASM_URL   = './circuits/withdraw.wasm'
export const CIRCUIT_ZKEY_URL   = './circuits/withdraw_final.zkey'
export const VERIFICATION_KEY_URL = './circuits/verification_key.json'
