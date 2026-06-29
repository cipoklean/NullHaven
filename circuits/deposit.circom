pragma circom 2.1.0;

include "node_modules/circomlib/circuits/poseidon.circom";

// ============================================================
// NullHaven: Deposit Commitment Circuit
// ============================================================
// Generates a commitment = Poseidon(secret, 0)
// The commitment is stored in the pool's Merkle tree.
// ============================================================

template DepositCommitment() {
    signal input secret;
    signal output commitment;

    component poseidon = Poseidon(2);
    poseidon.inputs[0] <== secret;
    poseidon.inputs[1] <== 0;
    commitment <== poseidon.out;
}

component main = DepositCommitment();
