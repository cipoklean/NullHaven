#!/usr/bin/env python3
"""Initialize the Groth16 verifier contract on testnet.

Reads verification_key.json, converts G1/G2 points to the Soroban byte
convention, and calls `stellar contract invoke` to store the vkey on-chain.

Usage:
  python scripts/init-verifier.py [--dry-run]
"""

import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.join(SCRIPT_DIR, "..")
CIRCUITS_DIR = os.path.join(PROJECT_DIR, "circuits")
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
STELLAR_CLI = os.path.expanduser("~/.cargo/bin/stellar.exe")


def load_env():
    """Extract STELLAR_SECRET and VITE_CONTRACT_VERIFIER from frontend/.env"""
    env_path = os.path.join(FRONTEND_DIR, ".env")
    env = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def bigint_to_bytes_be(val_str: str, n_bytes: int) -> str:
    """Convert decimal string to big-endian bytes of fixed width (hex)."""
    val = int(val_str)
    return val.to_bytes(n_bytes, "big").hex()


def g1_point(point: list) -> str:
    """Convert G1 point [x, y, "1"] to 64-byte hex (x||y)."""
    x = bigint_to_bytes_be(point[0], 32)
    y = bigint_to_bytes_be(point[1], 32)
    return "0x" + x + y


def g2_point(point: list) -> str:
    """Convert G2 point [[x_re, x_im], [y_re, y_im], ["1","0"]] to 128-byte hex.

    Soroban convention: x_im || x_re || y_im || y_re (each 32 bytes).
    snarkjs convention: point = [[x_re, x_im], [y_re, y_im], ["1","0"]]
    """
    x_re = bigint_to_bytes_be(point[0][0], 32)  # x.c1
    x_im = bigint_to_bytes_be(point[0][1], 32)  # x.c0
    y_re = bigint_to_bytes_be(point[1][0], 32)  # y.c1
    y_im = bigint_to_bytes_be(point[1][1], 32)  # y.c0
    # Soroban: x_im || x_re || y_im || y_re
    return "0x" + x_im + x_re + y_im + y_re


def build_vk_json(vk: dict) -> dict:
    """Build VerifyingKey JSON for stellar-cli."""
    alpha_g1 = g1_point(vk["vk_alpha_1"])
    beta_g2 = g2_point(vk["vk_beta_2"])
    gamma_g2 = g2_point(vk["vk_gamma_2"])
    delta_g2 = g2_point(vk["vk_delta_2"])
    ic = [g1_point(pt) for pt in vk["IC"]]

    return {
        "alpha_g1": alpha_g1,
        "beta_g2": beta_g2,
        "gamma_g2": gamma_g2,
        "delta_g2": delta_g2,
        "ic": ic,
    }


def main():
    env = load_env()
    secret = env.get("STELLAR_SECRET", "")
    verifier_id = env.get("VITE_CONTRACT_VERIFIER", "")

    if not secret:
        print("ERROR: STELLAR_SECRET not found in frontend/.env")
        sys.exit(1)
    if not verifier_id:
        print("ERROR: VITE_CONTRACT_VERIFIER not found in frontend/.env")
        sys.exit(1)

    # Load verification key
    vk_path = os.path.join(CIRCUITS_DIR, "verification_key.json")
    vk = json.load(open(vk_path))
    print(f"Loaded verification key: nPublic={vk['nPublic']}, curve={vk['curve']}")

    vk_json = build_vk_json(vk)
    print(f"Verifier contract ID: {verifier_id}")
    print(f"Admin: {secret[:4]}...{secret[-4:]}")
    print(f"alpha_g1: {vk_json['alpha_g1'][:20]}...")
    print(f"beta_g2 : {vk_json['beta_g2'][:20]}...")
    print(f"IC count: {len(vk_json['ic'])}")

    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("\nDry run — not executing.")
        # Print the full JSON for inspection
        print("\nVK JSON:")
        print(json.dumps(vk_json, indent=2))
        return

    # Build the command
    # The admin is the source account (secret key)
    # The vk is passed as a JSON struct
    vk_json_str = json.dumps(vk_json)

    cmd = [
        STELLAR_CLI,
        "contract", "invoke",
        "--id", verifier_id,
        "--source-account", secret,
        "--network", "testnet",
        "--",
        "init",
        "--admin", secret,
        "--vk", vk_json_str,
    ]

    print(f"\nExecuting init...")
    print(f"Command: {' '.join(c if c != secret else '***REDACTED***' for c in cmd)}")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=60,
    )

    print(f"\nExit code: {result.returncode}")
    if result.stdout:
        print("STDOUT:")
        print(result.stdout)
    if result.stderr:
        print("STDERR:")
        print(result.stderr)

    if result.returncode == 0:
        print("\n✅ Verifier initialized successfully!")
    else:
        print("\n❌ Verifier init FAILED. See output above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
