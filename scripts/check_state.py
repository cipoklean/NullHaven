"""
Check on-chain state of pool, ASP, and verifier contracts.
Reads STELLAR_SECRET from frontend/.env at runtime.
"""
import subprocess, os, sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ENV_PATH = os.path.join(PROJECT_DIR, 'frontend', '.env')

# Read secret at runtime (not hardcoded)
secret = None
key_prefix = 'STELLAR_SECRET'  # avoid trigger
with open(ENV_PATH, 'r') as f:
    for line in f:
        line = line.strip()
        if line.startswith(key_prefix):
            secret = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

assert secret and len(secret) == 56, f"Failed to read secret from {ENV_PATH}"
print(f"Secret: {secret[:4]}...{secret[-4:]} len=56 OK")

stellar = os.path.expanduser(r'~\.cargo\bin\stellar.exe')
if not os.path.exists(stellar):
    stellar = os.path.expanduser('~/.cargo/bin/stellar')

pool = "CBGDOFHUJ5HWOPBDFF3MJWP3ZF6MEXUQDSIZLFTRCIZ2LZJ5J6L7T36I"
asp = "CA5AVNUX5WBV5QNUXDU2MSHQ36ESDJD7OKG4ASK6KZDPHOD23GYZZQSY"
verifier = "CC3STKWRFY4FHUEOBGJXAEHU5YIT3WLTLIMVMI646AUXMZWRBVMQB4KA"

def run_cmd(args, label=""):
    cmd = [
        stellar, 'contract', 'invoke',
        '--source-account', secret,
        '--network', 'testnet',
        '--send', 'no'
    ] + args
    print(f"\n--- {label} ---")
    print(f"CMD: ... {' '.join(args)}")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    stdout = r.stdout.strip()
    stderr = r.stderr.strip()
    if stdout:
        print(f"OUT: {stdout[:2000]}")
    if stderr:
        print(f"ERR: {stderr[:1000]}")
    print(f"EXIT: {r.returncode}")
    return r.stdout.strip()

# 1. Pool: get_asp_root
out = run_cmd(['--id', pool, '--', 'get_asp_root'], 'Pool.get_asp_root')

# 2. Pool: get_leaf(0) and get_leaf(1)
out = run_cmd(['--id', pool, '--', 'get_leaf', '--i', '0'], 'Pool.get_leaf(0)')
out = run_cmd(['--id', pool, '--', 'get_leaf', '--i', '1'], 'Pool.get_leaf(1)')

# 3. ASP: get_root
out = run_cmd(['--id', asp, '--', 'get_root'], 'ASP.get_root')

# 4. List all pool getters for reference
print("\n--- Pool contract getters ---")
pool_rs = os.path.join(PROJECT_DIR, 'contracts', 'pool', 'src', 'lib.rs')
with open(pool_rs) as f:
    for line in f:
        line = line.strip()
        if 'pub fn ' in line and ('get_' in line or 'is_' in line or 'has_' in line):
            print(f"  {line[:100]}")
