#!/usr/bin/env python3
"""Initialize the NullHaven Pool contract on testnet."""
import subprocess, os, sys

# Read .env
env_path = r"C:\Users\HomePC\Desktop\stellar-privacy-pool\frontend\.env"
secret = None
with open(env_path, "r") as f:
    for line in f:
        line = line.strip()
        if line.startswith("STELLAR_SECRET=***            secret = line.split("=", 1)[1].strip().strip('"').strip("'")
            break

if not secret:
    print("ERROR: Could not find STELLAR_SECRET in .env")
    sys.exit(1)

print(f"Secret loaded: {secret[:4]}...{secret[-4:]} (len={len(secret)})")

STELLAR = r"C:\Users\HomePC\.cargo\bin\stellar.exe"

POOL = "CARKN3SL2JBFTZORBVSLC36ROQQGFZM4IVMRL7KTQS4M3AMFS5ZA26MJ"
TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
ASP = "CA5AVNUX5WBV5QNUXDU2MSHQ36ESDJD7OKG4ASK6KZDPHOD23GYZZQSY"
VERIFIER = "CC3STKWRFY4FHUEOBGJXAEHU5YIT3WLTLIMVMI646AUXMZWRBVMQB4KA"
ADMIN = secret  # source account is admin

print(f"\nInitializing pool {POOL}...")
result = subprocess.run(
    [
        STELLAR, "contract", "invoke",
        "--id", POOL,
        "--source-account", secret,
        "--network", "testnet",
        "--",
        "init",
        "--token", TOKEN,
        "--asp", ASP,
        "--verifier", VERIFIER,
        "--admin", ADMIN,
    ],
    capture_output=True,
    text=True,
    timeout=60
)

print(f"Exit: {result.returncode}")
if result.stdout:
    print("STDOUT:")
    print(result.stdout)
if result.stderr:
    print("STDERR:")
    print(result.stderr)
