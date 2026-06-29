#![no_std]
//! NullHaven — Groth16 BN254 verifier contract.
//!
//! Verifies Groth16 proofs using the Soroban BN254 host functions (Protocol 25+).
//! Implements: e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1
//! where  vk_x = IC[0] + Σᵢ pubInput[i] · IC[i+1]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, BytesN, Env, Vec,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Bn254Fr},
};

// ─── BN254 base-field prime p ─────────────────────────────────────────────────
// p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
// Used to negate G1 y-coordinate: y_neg = p - y
const BN254_FP: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

// ─── Error types ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VerifierError {
    AlreadyInit   = 1,
    NotInit       = 2,
    NotAuthorized = 3,
    /// public_inputs.len() != vk.ic.len() - 1
    InputMismatch = 4,
}

// ─── Storage types ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct Config { pub admin: Address }

/// Groth16 BN254 verification key.
///
/// G1 points: `BytesN<64>` — big-endian x‖y (32 bytes each).
/// G2 points: `BytesN<128>` — big-endian x_im‖x_re‖y_im‖y_re (32 bytes each).
///
/// `ic[0]` is the affine base constant; `ic[i+1]` is the coefficient for public input `i`.
#[contracttype]
#[derive(Clone)]
pub struct VerifyingKey {
    pub alpha_g1: BytesN<64>,
    pub beta_g2:  BytesN<128>,
    pub gamma_g2: BytesN<128>,
    pub delta_g2: BytesN<128>,
    pub ic:       Vec<BytesN<64>>,
}

#[contracttype]
pub enum Key { Conf, Init, Vk }

// ─── G1 helpers ───────────────────────────────────────────────────────────────

/// Negate a BN254 G1 affine point: (x, y) → (x, p − y).
///
/// Byte layout: `[x₀..x₃₁][y₀..y₃₁]` big-endian.
/// The point at infinity (all-zero bytes) is returned unchanged.
fn negate_g1(env: &Env, point: &Bn254G1Affine) -> Bn254G1Affine {
    let mut arr: [u8; 64] = point.to_bytes().to_array();
    if arr.iter().all(|&b| b == 0) { return point.clone(); }
    // Big-endian subtraction: p − y on bytes[32..63]
    let mut borrow: u16 = 0;
    for i in (32usize..64).rev() {
        let diff = (BN254_FP[i - 32] as i16) - (arr[i] as i16) - (borrow as i16);
        if diff < 0 { arr[i] = (diff + 256) as u8; borrow = 1; }
        else         { arr[i] = diff as u8;          borrow = 0; }
    }
    Bn254G1Affine::from_bytes(BytesN::from_array(env, &arr))
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Initialise the verifier — stores admin and verification key.
    pub fn init(env: Env, admin: Address, vk: VerifyingKey) -> Result<(), VerifierError> {
        if env.storage().instance().has(&Key::Init) {
            return Err(VerifierError::AlreadyInit);
        }
        admin.require_auth();
        env.storage().instance().set(&Key::Conf, &Config { admin });
        env.storage().instance().set(&Key::Vk,   &vk);
        env.storage().instance().set(&Key::Init,  &true);
        Ok(())
    }

    /// Replace the verification key — admin only.
    pub fn set_vk(env: Env, admin: Address, vk: VerifyingKey) -> Result<(), VerifierError> {
        let cfg: Config = env.storage().instance()
            .get(&Key::Conf).ok_or(VerifierError::NotInit)?;
        admin.require_auth();
        if admin != cfg.admin { return Err(VerifierError::NotAuthorized); }
        env.storage().instance().set(&Key::Vk, &vk);
        Ok(())
    }

    /// Verify a Groth16 BN254 proof.
    ///
    /// Proof layout:
    /// - `proof_a`  : G1 point (64 bytes)
    /// - `proof_b`  : G2 point (128 bytes)
    /// - `proof_c`  : G1 point (64 bytes)
    /// - `public_inputs`: vector of BN254 field elements (32 bytes each, big-endian)
    ///
    /// Returns `true` iff the proof is valid for the stored verification key.
    pub fn verify(
        env:           Env,
        proof_a:       BytesN<64>,
        proof_b:       BytesN<128>,
        proof_c:       BytesN<64>,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<bool, VerifierError> {
        let vk: VerifyingKey = env.storage().instance()
            .get(&Key::Vk).ok_or(VerifierError::NotInit)?;

        let n = public_inputs.len() as usize;
        // IC must have exactly n+1 elements
        if vk.ic.len() as usize != n + 1 {
            return Err(VerifierError::InputMismatch);
        }

        let bn254 = env.crypto().bn254();

        // ── Step 1: vk_x = IC[0] + g1_msm(IC[1..n+1], pubInputs[0..n]) ──────
        //
        // g1_msm is a single multi-scalar multiply — more efficient than
        // n individual g1_mul + g1_add calls.
        let ic0 = Bn254G1Affine::from_bytes(vk.ic.get_unchecked(0));

        let vk_x = if n == 0 {
            ic0
        } else {
            let mut pts: Vec<Bn254G1Affine> = Vec::new(&env);
            let mut scs: Vec<Bn254Fr>        = Vec::new(&env);
            for i in 0..n as u32 {
                pts.push_back(Bn254G1Affine::from_bytes(vk.ic.get_unchecked(i + 1)));
                scs.push_back(Bn254Fr::from_bytes(public_inputs.get_unchecked(i)));
            }
            let msm = bn254.g1_msm(pts, scs);
            bn254.g1_add(&ic0, &msm)
        };

        // ── Step 2: Negate proof_a ────────────────────────────────────────────
        let neg_a = negate_g1(&env, &Bn254G1Affine::from_bytes(proof_a));

        // ── Step 3: Multi-pairing check ───────────────────────────────────────
        // e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1
        let mut g1v: Vec<Bn254G1Affine> = Vec::new(&env);
        let mut g2v: Vec<Bn254G2Affine> = Vec::new(&env);

        g1v.push_back(neg_a);
        g2v.push_back(Bn254G2Affine::from_bytes(proof_b));

        g1v.push_back(Bn254G1Affine::from_bytes(vk.alpha_g1));
        g2v.push_back(Bn254G2Affine::from_bytes(vk.beta_g2));

        g1v.push_back(vk_x);
        g2v.push_back(Bn254G2Affine::from_bytes(vk.gamma_g2));

        g1v.push_back(Bn254G1Affine::from_bytes(proof_c));
        g2v.push_back(Bn254G2Affine::from_bytes(vk.delta_g2));

        Ok(bn254.pairing_check(g1v, g2v))
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    /// BN254 generator G1 = (1, 2) — a valid curve point.
    fn gen_g1(env: &Env) -> BytesN<64> {
        let mut arr = [0u8; 64];
        arr[31] = 1; // x = 1
        arr[63] = 2; // y = 2
        BytesN::from_array(env, &arr)
    }

    /// BN254 generator G2 (standard Ethereum alt_bn128 G2 generator).
    fn gen_g2(env: &Env) -> BytesN<128> {
        // Format: x_im‖x_re‖y_im‖y_re (each 32 bytes, big-endian)
        let x_im: [u8;32] = [
            0x19,0x8e,0x93,0x93,0x92,0x0d,0x48,0x3a,0x74,0x51,0x41,0x61,0x2b,0xea,0x09,0x27,
            0x23,0x67,0x57,0xf4,0xf3,0x49,0x17,0xd1,0xcc,0x04,0x07,0xc7,0xf8,0x2c,0x61,0x22,
        ];
        let x_re: [u8;32] = [
            0x18,0x00,0xde,0xef,0x12,0x1f,0x1e,0x76,0x26,0x02,0x11,0x69,0x0a,0x11,0x91,0x28,
            0x4a,0x0f,0x67,0x28,0xf5,0xf1,0x0f,0x86,0x36,0x25,0x4d,0x8a,0x38,0x67,0xa8,0x12,
        ];
        let y_im: [u8;32] = [
            0x09,0x06,0x89,0xd0,0x58,0x5f,0xf0,0x75,0xec,0x9e,0x99,0xad,0x69,0x0c,0x33,0x95,
            0xbc,0x4b,0x31,0x33,0x70,0xb3,0x8e,0xf3,0x55,0xac,0xda,0xdc,0xd1,0x22,0x97,0x5b,
        ];
        let y_re: [u8;32] = [
            0x12,0xc8,0x5e,0xa5,0xdb,0x8c,0x6d,0xeb,0x4a,0xab,0x71,0x80,0x8d,0xcb,0x40,0x8f,
            0xe3,0xd1,0xe7,0x69,0x0c,0x43,0xd3,0x7b,0x4c,0xe6,0xcc,0x01,0x66,0xfa,0x7d,0xaa,
        ];
        let mut arr = [0u8; 128];
        arr[  0.. 32].copy_from_slice(&x_im);
        arr[ 32.. 64].copy_from_slice(&x_re);
        arr[ 64.. 96].copy_from_slice(&y_im);
        arr[ 96..128].copy_from_slice(&y_re);
        BytesN::from_array(env, &arr)
    }

    fn dummy_vk(env: &Env, n_inputs: usize) -> VerifyingKey {
        let g1 = gen_g1(env);
        let g2 = gen_g2(env);
        let mut ic: Vec<BytesN<64>> = Vec::new(env);
        for _ in 0..=n_inputs { ic.push_back(g1.clone()); }
        VerifyingKey {
            alpha_g1: g1, beta_g2: g2.clone(),
            gamma_g2: g2.clone(), delta_g2: g2, ic,
        }
    }

    #[test]
    fn test_init_stores_vk() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register(Groth16Verifier, ());
        let client = Groth16VerifierClient::new(&env, &cid);
        let admin = Address::generate(&env);
        client.init(&admin, &dummy_vk(&env, 1));
        // init a second time → AlreadyInit
        assert_eq!(
            client.try_init(&admin, &dummy_vk(&env, 1)),
            Err(Ok(VerifierError::AlreadyInit))
        );
    }

    #[test]
    fn test_set_vk_admin_only() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register(Groth16Verifier, ());
        let client = Groth16VerifierClient::new(&env, &cid);
        let admin   = Address::generate(&env);
        let other   = Address::generate(&env);
        client.init(&admin, &dummy_vk(&env, 1));
        // non-admin is rejected
        assert_eq!(
            client.try_set_vk(&other, &dummy_vk(&env, 1)),
            Err(Ok(VerifierError::NotAuthorized))
        );
        // admin is accepted
        client.set_vk(&admin, &dummy_vk(&env, 2));
    }

    #[test]
    fn test_verify_input_count_mismatch() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register(Groth16Verifier, ());
        let client = Groth16VerifierClient::new(&env, &cid);
        let admin = Address::generate(&env);
        // vk has 2 IC points → needs exactly 1 public input
        client.init(&admin, &dummy_vk(&env, 1));

        let g1 = gen_g1(&env);
        let g2 = gen_g2(&env);
        let z: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);

        // 0 inputs → mismatch
        assert_eq!(
            client.try_verify(&g1, &g2, &g1, &Vec::new(&env)),
            Err(Ok(VerifierError::InputMismatch))
        );
        // 2 inputs → mismatch
        let mut two: Vec<BytesN<32>> = Vec::new(&env);
        two.push_back(z.clone()); two.push_back(z);
        assert_eq!(
            client.try_verify(&g1, &g2, &g1, &two),
            Err(Ok(VerifierError::InputMismatch))
        );
    }

    #[test]
    fn test_negate_g1_roundtrip() {
        let env  = Env::default();
        let orig = gen_g1(&env);
        let pt   = Bn254G1Affine::from_bytes(orig.clone());
        let neg  = negate_g1(&env, &pt);
        let back = negate_g1(&env, &neg);
        // negating twice returns the original coordinates
        assert_eq!(back.to_bytes(), orig);
    }

    #[test]
    fn test_negate_g1_infinity() {
        let env = Env::default();
        let inf: BytesN<64> = BytesN::from_array(&env, &[0u8; 64]);
        let pt  = Bn254G1Affine::from_bytes(inf.clone());
        assert_eq!(negate_g1(&env, &pt).to_bytes(), inf);
    }

    #[test]
    fn test_verify_not_init() {
        let env = Env::default();
        let cid = env.register(Groth16Verifier, ());
        let client = Groth16VerifierClient::new(&env, &cid);
        assert_eq!(
            client.try_verify(
                &gen_g1(&env), &gen_g2(&env), &gen_g1(&env), &Vec::new(&env)
            ),
            Err(Ok(VerifierError::NotInit))
        );
    }
}
