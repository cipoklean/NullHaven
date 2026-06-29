#!/usr/bin/env bash
set -e
cd "/c/Users/HomePC/Desktop/stellar-privacy-pool"

# Read STELLAR_SECRET from .env
SECRET=$(grep '^STELLAR_SECRET=' frontend/.env | head -1 | cut -d= -f2- | tr -d '\r\n')

echo "Secret loaded: ${SECRET:0:4}...${SECRET: -4}"

POOL="CBGDOFHUJ5HWOPBDFF3MJWP3ZF6MEXUQDSIZLFTRCIZ2LZJ5J6L7T36I"
TOKEN="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
ASP="CA5AVNUX5WBV5QNUXDU2MSHQ36ESDJD7OKG4ASK6KZDPHOD23GYZZQSY"
VERIFIER="CC3STKWRFY4FHUEOBGJXAEHU5YIT3WLTLIMVMI646AUXMZWRBVMQB4KA"
ADMIN="$SECRET"  # use secret as admin (the source account is the admin)

echo "Initializing pool..."
stellar contract invoke \
  --id "$POOL" \
  --source-account "$SECRET" \
  --network testnet \
  -- \
  init \
  --token "$TOKEN" \
  --asp "$ASP" \
  --verifier "$VERIFIER" \
  --admin "$ADMIN"
