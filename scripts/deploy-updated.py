#!/usr/bin/env python3
"""Deploy updated pool + verifier contracts and initialize them.

Two contracts change with the split-recipient fix:
  1. groth16-verifier — new vkey (circuit public inputs changed from 5→6+hash)
  2. nullhaven-pool     — new code (lo/hi recipient split)

ASP and Compliance contracts are unchanged — reuse existing instances.

Usage:
  cd C:/Users/HomePC/Desktop/stellar-privacy-pool
  python scripts/deploy-updated.py [--dry-run]
"""

import json, os, subprocess, sys, shlex

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_ENV = os.path.join(ROOT, 'frontend', '.env')
WASM_DIR = os.path.join(ROOT, 'contracts', 'target', 'wasm32v1-none', 'release')
CIRCUITS_DIR = os.path.join(ROOT, 'circuits')
NETWORK = 'testnet'

# --- env helpers ---

def load_env():
    env = {}
    with open(FRONTEND_ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env

def get_secret(env):
    """Extract STELLAR_SECRET from .env safely (avoids shell semicolon bug)."""
    s = env.get('STELLAR_SECRET', '')
    if not s:
        print("ERROR: STELLAR_SECRET not in frontend/.env")
        sys.exit(1)
    return s

# --- stellar-cli ---

def stellar(*args):
    """Run stellar-cli command, return stripped stdout."""
    cmd = ['stellar'] + list(args)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            print(f"  ✗ stellar {' '.join(args[:3])}... failed: {result.stderr.strip()}")
            return None
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        print(f"  ✗ stellar {' '.join(args[:3])}... timed out")
        return None

def get_sac_address():
    """Get the native XLM SAC token address on testnet."""
    return stellar('contract', 'id', 'asset', '--asset', 'native', '--network', NETWORK)

# --- vkey conversion ---

def bn_to_hex_be(dec_str, n_bytes=32):
    """Convert decimal string to big-endian hex of fixed width."""
    return int(dec_str).to_bytes(n_bytes, 'big').hex()

def snarkjs_g1_to_hex(point):
    """snarkjs G1 [x, y, "1"] → 64 hex chars (x||y big-endian)."""
    return bn_to_hex_be(point[0], 32) + bn_to_hex_be(point[1], 32)

def snarkjs_g2_to_hex(point):
    """snarkjs G2 [[x_re,x_im],[y_re,y_im],["1","0"]] → 256 hex chars.

    Soroban BN254 expects x_im || x_re || y_im || y_re (each 32 bytes),
    matching snarkjs Solidity calldata / EIP-197 ordering. Keep this in sync
    with frontend/src/utils/zk.ts encodeG2().
    """
    x_re = bn_to_hex_be(point[0][0], 32)
    x_im = bn_to_hex_be(point[0][1], 32)
    y_re = bn_to_hex_be(point[1][0], 32)
    y_im = bn_to_hex_be(point[1][1], 32)
    return x_im + x_re + y_im + y_re

def build_vk_json(vk):
    """Build VerifyingKey as a JSON string for stellar-cli."""
    ic_hex = [snarkjs_g1_to_hex(pt) for pt in vk['IC']]
    obj = {
        'alpha_g1': snarkjs_g1_to_hex(vk['vk_alpha_1']),
        'beta_g2':  snarkjs_g2_to_hex(vk['vk_beta_2']),
        'gamma_g2': snarkjs_g2_to_hex(vk['vk_gamma_2']),
        'delta_g2': snarkjs_g2_to_hex(vk['vk_delta_2']),
        'ic':       ic_hex,
    }
    return json.dumps(obj)

# --- main ---

def main():
    env = load_env()
    secret = get_secret(env)
    
    # Existing reused contracts
    asp_id = env.get('VITE_CONTRACT_ASP', '')
    compliance_id = env.get('VITE_CONTRACT_COMPLIANCE', '')
    
    print("=" * 70)
    print("  NullHaven — Deploy Updated Contracts (split-recipient fix)")
    print("=" * 70)
    print(f"  Network: {NETWORK}")
    print(f"  Source:  {secret[:4]}...{secret[-4:]}")
    print()
    
    # 1. Deploy new verifier
    print("─── Deploying Groth16 Verifier (new vkey) ───")
    verifier_wasm = os.path.join(WASM_DIR, 'groth16_verifier.wasm')
    if not os.path.exists(verifier_wasm):
        print(f"  ✗ WASM not found: {verifier_wasm}")
        print("    Build first: cd contracts && cargo build --target wasm32v1-none --release")
        sys.exit(1)
    
    new_verifier_id = stellar(
        'contract', 'deploy',
        '--wasm',      verifier_wasm,
        '--source-account', secret,
        '--network',   NETWORK,
    )
    if not new_verifier_id:
        sys.exit(1)
    print(f"  ✓ Verifier deployed: {new_verifier_id}")
    
    # 2. Init verifier with new vkey
    print("\n─── Initializing Verifier ───")
    vk_path = os.path.join(CIRCUITS_DIR, 'verification_key.json')
    vk = json.load(open(vk_path))
    print(f"  vkey: nPublic={vk['nPublic']}, IC entries={len(vk['IC'])}")
    
    vk_json = build_vk_json(vk)
    
    dry_run = '--dry-run' in sys.argv
    if dry_run:
        print(f"  [DRY RUN] Would init with vk JSON ({len(vk_json)} chars)")
    else:
        result = stellar(
            'contract', 'invoke',
            '--id',             new_verifier_id,
            '--source-account', secret,
            '--network',        NETWORK,
            '--',
            'init',
            '--admin', secret,
            '--vk',   vk_json,
        )
        if result is None:
            print("  ✗ Verifier init failed")
            sys.exit(1)
        print(f"  ✓ Verifier initialized")
    
    # 3. Deploy new pool
    print("\n─── Deploying NullHaven Pool (updated code) ───")
    pool_wasm = os.path.join(WASM_DIR, 'nullhaven_pool.wasm')
    if not os.path.exists(pool_wasm):
        print(f"  ✗ WASM not found: {pool_wasm}")
        sys.exit(1)
    
    new_pool_id = stellar(
        'contract', 'deploy',
        '--wasm',          pool_wasm,
        '--source-account', secret,
        '--network',       NETWORK,
    )
    if not new_pool_id:
        sys.exit(1)
    print(f"  ✓ Pool deployed: {new_pool_id}")
    
    # 4. Init pool
    print("\n─── Initializing Pool ───")
    sac_addr = get_sac_address()
    if not sac_addr:
        print("  ✗ Could not get SAC token address")
        sys.exit(1)
    print(f"  SAC token: {sac_addr}")
    print(f"  ASP:       {asp_id}")
    print(f"  Verifier:  {new_verifier_id}")
    
    if dry_run:
        print("  [DRY RUN] Would init pool")
    else:
        result = stellar(
            'contract', 'invoke',
            '--id',             new_pool_id,
            '--source-account', secret,
            '--network',        NETWORK,
            '--',
            'init',
            '--token',    sac_addr,
            '--asp',      asp_id,
            '--verifier', new_verifier_id,
            '--admin',    secret,
        )
        if result is None:
            print("  ✗ Pool init failed")
            sys.exit(1)
        print(f"  ✓ Pool initialized")
    
    # 5. Summary
    print("\n" + "=" * 70)
    print("  DEPLOYMENT SUMMARY")
    print("=" * 70)
    print(f"  Pool:     {new_pool_id}")
    print(f"  Verifier: {new_verifier_id}")
    print(f"  ASP:      {asp_id}          (reused)")
    print(f"  Compl:    {compliance_id}          (reused)")
    print()
    print("  Update frontend/.env:")
    print(f"    VITE_CONTRACT_POOL={new_pool_id}")
    print(f"    VITE_CONTRACT_VERIFIER={new_verifier_id}")
    print()

if __name__ == '__main__':
    main()
