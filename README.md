# NullHaven — Compliant Privacy Pools on Stellar

> *Private transactions with built-in regulatory safeguards — zero-knowledge proofs verified on Stellar's Soroban platform.*

**Stellar Hacks: Real-World ZK** | [DoraHacks Submission](https://dorahacks.io/hackathon/stellar-hacks-zk)

---

## Overview

NullHaven is a **compliant privacy pool** built on Stellar using zero-knowledge proofs. Users can deposit tokens into a shielded pool and withdraw to any address without creating a public on-chain link between the two. **Association Set Providers (ASPs)** manage allow/deny lists — legitimate users transact privately while known bad actors are blocked.

### Key Features

- **🔒 Private Payments** — Deposit and withdraw with ZK proofs. No on-chain link between sender and recipient.
- **✅ ASP Compliance** — Allowlists & denylists enforced at the circuit level. Bad actors cannot withdraw.
- **🔍 Auditor Access** — Encrypted view keys let authorized auditors inspect specific commitments.
- **⚡ Stellar Native** — Uses Protocol 25+ BN254 host functions for cheap on-chain proof verification.
- **🖥️ Client-Side Proving** — ZK proofs generated in the browser — secrets never leave your device.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React + Vite)                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │  Deposit  │  │ Withdraw │  │ ASP      │  │ Compliance  │ │
│  │  Flow     │  │ Flow     │  │ Admin    │  │ Dashboard   │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       │              │             │                │        │
│  ┌────▼──────────────▼─────────────▼────────────────▼──────┐ │
│  │              Stellar Wallets Kit + SDK                  │ │
│  └──────────────────────────┬──────────────────────────────┘ │
└─────────────────────────────┼────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────┐
│  Soroban Smart Contracts   │                                 │
│  ┌──────────────────────────▼──────────────────────────────┐ │
│  │                    Pool Contract                         │ │
│  │  • Deposit (commitment → Merkle tree)                   │ │
│  │  • Withdraw (ZK proof → nullifier check → token tx)     │ │
│  └──────────┬──────────────────────┬───────────────────────┘ │
│             │                      │                          │
│  ┌──────────▼──────┐    ┌──────────▼──────────┐              │
│  │ Groth16 Verifier │    │  ASP Contract       │              │
│  │ (BN254 pairing)  │    │  • Allowlist Mgmt   │              │
│  └──────────────────┘    │  • Denylist Mgmt    │              │
│                          └──────────────────────┘              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              Compliance Registry                         │ │
│  │  • View key registration & auditor management            │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

## Deployed Contracts (Stellar Testnet)

| Contract | Address |
|----------|---------|
| **Pool** | `CARKN3SL2JBFTZORBVSLC36ROQQGFZM4IVMRL7KTQS4M3AMFS5ZA26MJ` |
| **Groth16 Verifier** | `CC3STKWRFY4FHUEOBGJXAEHU5YIT3WLTLIMVMI646AUXMZWRBVMQB4KA` |
| **ASP** | `CA5AVNUX5WBV5QNUXDU2MSHQ36ESDJD7OKG4ASK6KZDPHOD23GYZZQSY` |
| **Compliance Registry** | `CAAZE5M2WRBNB3ACSPC4E3FJ63RXIVYFVFCO7FGW4YBT3FNXEHN4O5NH` |

## Smart Contracts

### 1. Pool Contract
Core shielded pool managing deposits, withdrawals, and state.

| Method | Description |
|--------|-------------|
| `init(token, asp, verifier, admin)` | Initialize pool with token, ASP, verifier, and admin addresses |
| `deposit(from, commitment, amount)` | Deposit tokens, store commitment in Merkle tree |
| `withdraw(to, nullifier, root, proof, path, indices, aspProof?)` | Submit ZK proof and withdraw tokens |
| `set_asp_root(root)` | Update ASP Merkle root |

### 2. Groth16 Verifier
Verifies Groth16 zk-SNARK proofs using Stellar's BN254 host functions.

| Method | Description |
|--------|-------------|
| `init(vk)` | Store verification key |
| `set_vk(admin, vk)` | Update verification key |
| `verify(proof_a, proof_b, proof_c, public_inputs)` | Verify Groth16 proof |

### 3. ASP Contract
Association Set Provider — manages allow/deny lists.

| Method | Description |
|--------|-------------|
| `init(admin)` | Set ASP admin address |
| `add_member(admin, commitment)` | Add to allowlist |
| `remove_member(admin, commitment)` | Remove from allowlist |
| `is_member(commitment)` | Check allowlist membership |
| `add_denied(admin, commitment)` | Add to denylist |
| `remove_denied(admin, commitment)` | Remove from denylist |
| `is_denied(commitment)` | Check denylist status |

### 4. Compliance Registry
Manages auditor access and encrypted view keys.

| Method | Description |
|--------|-------------|
| `init(authorizer)` | Set authorizer address |
| `register_auditor(authorizer, auditor, label)` | Register an auditor |
| `remove_auditor(authorizer, auditor)` | Remove auditor |
| `register_view_key(commitment, encrypted_key)` | Register view key for a commitment |
| `get_view_key(caller, commitment)` | Retrieve encrypted view key (auditor only) |

## ZK Circuits

### Withdraw Circuit (`circuits/withdraw.circom`)

The withdrawal circuit proves:

1. **Knowledge of secret** — `Poseidon(secret, 0) == commitment`
2. **Nullifier derivation** — `Poseidon(secret, 1) == nullifier`
3. **Merkle inclusion** — Commitment exists in the pool's Merkle tree at a given root
4. **ASP membership** (optional) — Commitment is in the ASP allowlist
5. **ASP non-membership** (implied) — Commitment is NOT in the denylist (checked by contract)

### Deposit Circuit (`circuits/deposit.circom`)

Simple commitment generation: `commitment = Poseidon(secret, 0)`

## Technology Stack

| Component | Technology |
|-----------|------------|
| **Blockchain** | Stellar (Soroban) |
| **Smart Contracts** | Rust + soroban-sdk 27.0.0-rc.1 |
| **ZK Proofs** | Circom + Groth16 (BN254 curve) |
| **On-Chain Verification** | BN254 host functions (CAP-0074/0075) |
| **Frontend** | React 19 + Vite + TypeScript |
| **Wallet** | Stellar Wallets Kit |
| **ZK Client** | snarkjs (WASM proof generation) |
| **Styling** | Tailwind CSS |

## Getting Started

### Prerequisites

- Node.js 18+
- Rust 1.96+
- `wasm32v1-none` target
- Stellar CLI (`cargo install stellar-cli`)
- Circom 2.1+

### Setup

```bash
# Clone and install
git clone https://github.com/your-org/nullhaven
cd nullhaven
npm install

# Build contracts
cd contracts
cargo build --target wasm32v1-none --release
cd ..

# Install & build frontend
cd frontend
npm install
npm run build
cd ..
```

### Deploy Contracts

```bash
# Set your Stellar testnet secret key
export STELLAR_SECRET=SCYOUR_SECRET_KEY_HERE

# Deploy all contracts
node scripts/deploy.mjs
```

### Configure Frontend

Update `frontend/src/config/index.ts` with your deployed contract addresses:

```typescript
export const CONTRACTS = {
  pool: 'CCYOUR_POOL_CONTRACT_ID',
  verifier: 'CCYOUR_VERIFIER_CONTRACT_ID',
  asp: 'CCYOUR_ASP_CONTRACT_ID',
  compliance: 'CCYOUR_COMPLIANCE_CONTRACT_ID',
}
```

### Build ZK Circuits

```bash
cd circuits
circom withdraw.circom --r1cs --wasm --sym
circom deposit.circom --r1cs --wasm --sym
```

### Run Frontend

```bash
cd frontend
npm run dev
```

## Usage Flow

### 1. User Deposits
```
User → Generate secret + commitment (in browser)
     → Deposit tokens + commitment to Pool contract
     → Pool stores commitment in Merkle tree
     → User saves secret (needed for withdrawal)
```

### 2. User Withdraws
```
User → Enter secret + recipient address
     → Browser generates ZK proof (with Merkle path + ASP proof)
     → Submit proof to Pool contract
     → Contract verifies: ZK proof ✓, nullifier unique ✓, Merkle path ✓
     → Contract checks ASP: not on denylist ✓, optionally on allowlist ✓
     → Tokens transferred to recipient
```

### 3. ASP Administrator
```
Admin → Add compliant commitments to allowlist
      → Block bad actors via denylist
      → Updates Merkle roots for proofs
```

## Prize Track Fit

This project targets the **$10,000 open innovation track**:

- **ZK Integration** — Groth16 proofs with BN254 verification on Soroban
- **Real-World Use Case** — Compliant privacy for Stellar's primary use case (payments, stablecoins, RWAs)
- **ASP Compliance** — Directly addresses regulatory concerns while preserving user privacy
- **Stellar Native** — Uses Protocol 25/26 host functions (BN254, Poseidon)
- **Auditable** — Compliance Registry with view key mechanism

## Testing

```bash
cd contracts
cargo test
```

## License

MIT
