"""
Check verifier initialization state.
Reads STELLAR_SECRET from frontend/.env at runtime.
"""
import subprocess, os, sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ENV_PATH = os.path.join(PROJECT_DIR, 'frontend', '.env')

secret = None
key_prefix = 'STELLAR_SECRET'
with open(ENV_PATH, 'r') as f:
    for line in f:
        line = line.strip()
        if line.startswith(key_prefix):
            secret = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

assert secret and len(secret) == 56, f"Failed to read secret"

stellar = os.path.expanduser(r'~\.cargo\bin\stellar.exe')
verifier = "CC3STKWRFY4FHUEOBGJXAEHU5YIT3WLTLIMVMI646AUXMZWRBVMQB4KA"

# Try to call verify on the verifier — will return NotInit if uninitialized
cmd = [
    stellar, 'contract', 'invoke',
    '--source-account', secret,
    '--network', 'testnet',
    '--send', 'no',
    '--id', verifier,
    '--',
    'verify',
    '--proof_a', '00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002',
    '--proof_b', '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    '--proof_c', '00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002',
]

# We need to handle public_inputs. stellar-cli v27 expects --public_inputs with individual values
# For empty vec, we might pass nothing or --public_inputs ""
# Let's try with passing public_inputs as an empty string or just one dummy value

print("=== Checking verifier init state ===\n")

# Try 1: with one dummy public input (will cause InputMismatch if init'd, NotInit if not)
cmd2 = cmd + ['--public_inputs', '0000000000000000000000000000000000000000000000000000000000000000']
r = subprocess.run(cmd2, capture_output=True, text=True, timeout=30)

stdout = r.stdout.strip()
stderr = r.stderr.strip()

print(f"EXIT: {r.returncode}")
if stdout:
    print(f"OUT: {stdout[:2000]}")
if stderr:
    # Look for NotInit or other errors
    lines = [l for l in stderr.split('\n') if 'error:' in l.lower()]
    print(f"ERR: {stderr[:1000]}")
    if lines:
        for l in lines:
            print(f"  → {l.strip()}")

# Print for analysis
print("\n--- Full stderr ---")
print(stderr[:2000])
