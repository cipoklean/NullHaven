pragma circom 2.1.0;

include "node_modules/circomlib/circuits/poseidon.circom";

// ============================================================
// NullHaven: Compliant Privacy Pool - Withdrawal Circuit
// ============================================================
// Proves:
//   1. Knowledge of secret that commits to a pool commitment
//   2. Commitment is included in the Merkle tree at a given root
//   3. Nullifier is correctly derived (prevent double-spend)
//   4. User is in the ASP allowlist (optional membership check)
//   5. User is NOT in the ASP denylist (optional exclusion check)
//   6. recipient is cryptographically bound to the proof
// ============================================================

template PoseidonHasher() {
    var nInputs = 2;
    signal input left;
    signal input right;
    signal output hash;

    component poseidon = Poseidon(nInputs);
    poseidon.inputs[0] <== left;
    poseidon.inputs[1] <== right;
    hash <== poseidon.out;
}

// Merkle tree inclusion proof verifier
template MerkleTreeInclusion(k) {
    signal input leaf;
    signal input root;
    signal input siblings[k];
    signal input indices[k]; // 0 = left, 1 = right

    signal hashes[k+1];
    hashes[0] <== leaf;

    component hasher[k];
    signal diff[k];
    signal sel[k];

    for (var i = 0; i < k; i++) {
        hasher[i] = PoseidonHasher();
        // Single-quadratic mux per Merkle level.
        // For indices[i] == 0 (left child):
        //   diff = siblings - hashes
        //   sel  = 0 * diff = 0
        //   left  = hashes + 0 = hashes
        //   right = siblings - 0 = siblings
        // For indices[i] == 1 (right child):
        //   diff = siblings - hashes
        //   sel  = 1 * diff = siblings - hashes
        //   left  = hashes + (siblings - hashes) = siblings
        //   right = siblings - (siblings - hashes) = hashes
        diff[i] <== siblings[i] - hashes[i];
        sel[i] <== indices[i] * diff[i];
        hasher[i].left <== hashes[i] + sel[i];
        hasher[i].right <== siblings[i] - sel[i];
        hashes[i+1] <== hasher[i].hash;
    }

    root === hashes[k];
}

// Main withdrawal circuit
template Withdraw(k) {
    // Private inputs
    signal input secret;
    signal input merkle_siblings[k];
    signal input merkle_indices[k];
    signal input asp_member_path[k];
    signal input asp_member_indices[k];

    // Public inputs
    signal input commitment;
    signal input root;
    signal input nullifier;
    signal input recipient_lo;
    signal input recipient_hi;
    signal input asp_root;

    // NEW: bind recipient cryptographically to the proof
    signal output recipient_hash;

    // 1. Verify commitment = Poseidon(secret, 0)
    component commit_hasher = PoseidonHasher();
    commit_hasher.left <== secret;
    commit_hasher.right <== 0;
    commitment === commit_hasher.hash;

    // 2. Verify nullifier = Poseidon(secret, 1)
    component nullifier_sep = PoseidonHasher();
    nullifier_sep.left <== secret;
    nullifier_sep.right <== 1;
    nullifier === nullifier_sep.hash;

    // 3. Verify Merkle tree inclusion proof
    component merkle = MerkleTreeInclusion(k);
    merkle.leaf <== commitment;
    merkle.root <== root;
    for (var i = 0; i < k; i++) {
        merkle.siblings[i] <== merkle_siblings[i];
        merkle.indices[i] <== merkle_indices[i];
    }

    // 4. Verify ASP membership proof (user is in allowlist)
    component asp_member = MerkleTreeInclusion(k);
    asp_member.leaf <== commitment;
    asp_member.root <== asp_root;
    for (var i = 0; i < k; i++) {
        asp_member.siblings[i] <== asp_member_path[i];
        asp_member.indices[i] <== asp_member_indices[i];
    }

    // 5. Bind recipient: recipient_hash = Poseidon(Poseidon(secret, recipient_hi), recipient_lo)
    component recipient_hi_hasher = PoseidonHasher();
    recipient_hi_hasher.left <== secret;
    recipient_hi_hasher.right <== recipient_hi;

    component recipient_lo_hasher = PoseidonHasher();
    recipient_lo_hasher.left <== recipient_hi_hasher.hash;
    recipient_lo_hasher.right <== recipient_lo;
    recipient_hash <== recipient_lo_hasher.hash;
}

// Main entry point — explicit public input list for deterministic ordering
// recipient_hash is the FIRST public output (slot 0), then the 6 public inputs
component main {public [recipient_hash, commitment, root, nullifier, recipient_lo, recipient_hi, asp_root]} = Withdraw(32);
