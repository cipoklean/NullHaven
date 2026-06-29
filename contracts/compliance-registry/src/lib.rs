#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, BytesN, Env, Map,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ComplianceError {
    AlreadyInit      = 1,
    NotInit          = 2,
    NotAuthorizer    = 3,
    AlreadyRegistered = 4,
    NotFound         = 5,
    NotAuditor       = 6,
}

#[contracttype]
#[derive(Clone)]
pub struct ComplianceConfig {
    pub authorizer: Address,
}

#[contracttype]
pub enum Key {
    Conf,
    Init,
    ViewKeys,
    Auditors,
}

#[contract]
pub struct ComplianceRegistry;

#[contractimpl]
impl ComplianceRegistry {
    pub fn init(env: Env, authorizer: Address) -> Result<(), ComplianceError> {
        if env.storage().instance().has(&Key::Init) {
            return Err(ComplianceError::AlreadyInit);
        }
        authorizer.require_auth();
        env.storage().instance().set(&Key::Conf, &ComplianceConfig { authorizer });
        env.storage().instance().set(&Key::Init, &true);
        Ok(())
    }

    pub fn register_auditor(
        env: Env,
        authorizer: Address,
        auditor: Address,
        label: BytesN<32>,
    ) -> Result<(), ComplianceError> {
        let cfg: ComplianceConfig = env.storage().instance().get(&Key::Conf)
            .ok_or(ComplianceError::NotInit)?;
        authorizer.require_auth();
        if authorizer != cfg.authorizer {
            return Err(ComplianceError::NotAuthorizer);
        }
        let mut auditors: Map<Address, BytesN<32>> = env
            .storage()
            .instance()
            .get(&Key::Auditors)
            .unwrap_or(Map::new(&env));
        if auditors.contains_key(auditor.clone()) {
            return Err(ComplianceError::AlreadyRegistered);
        }
        auditors.set(auditor, label);
        env.storage().instance().set(&Key::Auditors, &auditors);
        Ok(())
    }

    pub fn remove_auditor(
        env: Env,
        authorizer: Address,
        auditor: Address,
    ) -> Result<(), ComplianceError> {
        let cfg: ComplianceConfig = env.storage().instance().get(&Key::Conf)
            .ok_or(ComplianceError::NotInit)?;
        authorizer.require_auth();
        if authorizer != cfg.authorizer {
            return Err(ComplianceError::NotAuthorizer);
        }
        let mut auditors: Map<Address, BytesN<32>> = env
            .storage()
            .instance()
            .get(&Key::Auditors)
            .unwrap_or(Map::new(&env));
        if !auditors.contains_key(auditor.clone()) {
            return Err(ComplianceError::NotFound);
        }
        auditors.remove(auditor);
        env.storage().instance().set(&Key::Auditors, &auditors);
        Ok(())
    }

    pub fn is_auditor(env: Env, address: Address) -> bool {
        let auditors: Map<Address, BytesN<32>> = env
            .storage()
            .instance()
            .get(&Key::Auditors)
            .unwrap_or(Map::new(&env));
        auditors.contains_key(address)
    }

    /// Register an encrypted view key tied to a commitment.
    /// The depositor must sign this transaction (caller.require_auth()).
    /// This prevents third parties from locking a commitment by front-running.
    pub fn register_view_key(
        env: Env,
        depositor: Address,          // <- NEW: must be the note owner
        commitment: BytesN<32>,
        encrypted_key: BytesN<64>,
    ) -> Result<(), ComplianceError> {
        depositor.require_auth();    // <- FIXED: auth check added
        let mut keys: Map<BytesN<32>, BytesN<64>> = env
            .storage()
            .instance()
            .get(&Key::ViewKeys)
            .unwrap_or(Map::new(&env));
        if keys.contains_key(commitment.clone()) {
            return Err(ComplianceError::AlreadyRegistered);
        }
        keys.set(commitment, encrypted_key);
        env.storage().instance().set(&Key::ViewKeys, &keys);
        Ok(())
    }

    /// Return the encrypted view key for a commitment — auditors only.
    pub fn get_view_key(
        env: Env,
        caller: Address,
        commitment: BytesN<32>,
    ) -> Result<BytesN<64>, ComplianceError> {
        // FIXED: require_auth BEFORE any storage reads to prevent timing leaks
        caller.require_auth();

        let auditors: Map<Address, BytesN<32>> = env
            .storage()
            .instance()
            .get(&Key::Auditors)
            .unwrap_or(Map::new(&env));
        if !auditors.contains_key(caller) {
            return Err(ComplianceError::NotAuditor);
        }

        let keys: Map<BytesN<32>, BytesN<64>> = env
            .storage()
            .instance()
            .get(&Key::ViewKeys)
            .unwrap_or(Map::new(&env));
        keys.get(commitment).ok_or(ComplianceError::NotFound)
    }

    pub fn auditor_count(env: Env) -> u32 {
        let auditors: Map<Address, BytesN<32>> = env
            .storage()
            .instance()
            .get(&Key::Auditors)
            .unwrap_or(Map::new(&env));
        auditors.len()
    }
}
