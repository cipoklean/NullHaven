#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, BytesN, Env, Map,
};
// Note: Bytes import removed — the unused SHA-256 helper h() has been deleted.

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum AspError {
    AlreadyInit   = 1,
    NotInit       = 2,
    NotAdmin      = 3,
    AlreadyListed = 4,
    NotFound      = 5,
    Conflict      = 6,  // commitment is in the opposite list
}

#[contracttype]
#[derive(Clone)]
pub struct AspConfig {
    pub admin: Address,
}

#[contracttype]
pub enum Key {
    Conf,
    Init,
    Members,
    Denied,
}

#[contract]
pub struct Asp;

#[contractimpl]
impl Asp {
    pub fn init(env: Env, admin: Address) -> Result<(), AspError> {
        if env.storage().instance().has(&Key::Init) {
            return Err(AspError::AlreadyInit);
        }
        admin.require_auth();
        env.storage().instance().set(&Key::Conf, &AspConfig { admin });
        env.storage().instance().set(&Key::Init, &true);
        Ok(())
    }

    /// Add a commitment to the allow-list.
    /// Rejected if the commitment is already on the deny-list (mutual exclusion).
    pub fn add_member(
        env: Env,
        admin: Address,
        commitment: BytesN<32>,
    ) -> Result<(), AspError> {
        let cfg: AspConfig = env.storage().instance().get(&Key::Conf)
            .ok_or(AspError::NotInit)?;
        admin.require_auth();
        if admin != cfg.admin {
            return Err(AspError::NotAdmin);
        }

        // FIXED: mutual exclusion — cannot be in denied list
        let denied: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Denied)
            .unwrap_or(Map::new(&env));
        if denied.contains_key(commitment.clone()) {
            return Err(AspError::Conflict);
        }

        let mut members: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Members)
            .unwrap_or(Map::new(&env));
        if members.contains_key(commitment.clone()) {
            return Err(AspError::AlreadyListed);
        }
        members.set(commitment.clone(), true);
        env.storage().instance().set(&Key::Members, &members);
        env.events().publish(("member_added",), commitment);
        Ok(())
    }

    pub fn remove_member(
        env: Env,
        admin: Address,
        commitment: BytesN<32>,
    ) -> Result<(), AspError> {
        let cfg: AspConfig = env.storage().instance().get(&Key::Conf)
            .ok_or(AspError::NotInit)?;
        admin.require_auth();
        if admin != cfg.admin {
            return Err(AspError::NotAdmin);
        }
        let mut members: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Members)
            .unwrap_or(Map::new(&env));
        if !members.contains_key(commitment.clone()) {
            return Err(AspError::NotFound);
        }
        members.remove(commitment.clone());
        env.storage().instance().set(&Key::Members, &members);
        env.events().publish(("member_removed",), commitment);
        Ok(())
    }

    pub fn is_member(env: Env, commitment: BytesN<32>) -> bool {
        let members: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Members)
            .unwrap_or(Map::new(&env));
        members.contains_key(commitment)
    }

    /// Add a commitment to the deny-list.
    /// Rejected if the commitment is already on the allow-list (mutual exclusion).
    pub fn add_denied(
        env: Env,
        admin: Address,
        commitment: BytesN<32>,
    ) -> Result<(), AspError> {
        let cfg: AspConfig = env.storage().instance().get(&Key::Conf)
            .ok_or(AspError::NotInit)?;
        admin.require_auth();
        if admin != cfg.admin {
            return Err(AspError::NotAdmin);
        }

        // FIXED: mutual exclusion — cannot be in members list
        let members: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Members)
            .unwrap_or(Map::new(&env));
        if members.contains_key(commitment.clone()) {
            return Err(AspError::Conflict);
        }

        let mut denied: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Denied)
            .unwrap_or(Map::new(&env));
        if denied.contains_key(commitment.clone()) {
            return Err(AspError::AlreadyListed);
        }
        denied.set(commitment.clone(), true);
        env.storage().instance().set(&Key::Denied, &denied);
        env.events().publish(("denied_added",), commitment);
        Ok(())
    }

    pub fn remove_denied(
        env: Env,
        admin: Address,
        commitment: BytesN<32>,
    ) -> Result<(), AspError> {
        let cfg: AspConfig = env.storage().instance().get(&Key::Conf)
            .ok_or(AspError::NotInit)?;
        admin.require_auth();
        if admin != cfg.admin {
            return Err(AspError::NotAdmin);
        }
        let mut denied: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Denied)
            .unwrap_or(Map::new(&env));
        if !denied.contains_key(commitment.clone()) {
            return Err(AspError::NotFound);
        }
        denied.remove(commitment.clone());
        env.storage().instance().set(&Key::Denied, &denied);
        env.events().publish(("denied_removed",), commitment);
        Ok(())
    }

    pub fn is_denied(env: Env, commitment: BytesN<32>) -> bool {
        let denied: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Denied)
            .unwrap_or(Map::new(&env));
        denied.contains_key(commitment)
    }

    pub fn member_count(env: Env) -> u32 {
        // TODO (PERF): replace with a dedicated counter key to avoid full map deserialisation
        let members: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Members)
            .unwrap_or(Map::new(&env));
        members.len()
    }

    pub fn denied_count(env: Env) -> u32 {
        // TODO (PERF): replace with a dedicated counter key
        let denied: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&Key::Denied)
            .unwrap_or(Map::new(&env));
        denied.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, Address, AspClient<'static>) {
        let env = Env::default();
        let admin = Address::generate(&env);
        env.mock_all_auths();
        let cid = env.register(Asp, ());
        let client = AspClient::new(&env, &cid);
        (env, admin, client)
    }

    #[test]
    fn test_init_success() {
        let (env, admin, client) = setup();
        client.init(&admin);
        assert_eq!(client.try_init(&admin), Err(Ok(AspError::AlreadyInit)));
    }

    #[test]
    fn test_add_and_is_member() {
        let (env, admin, client) = setup();
        client.init(&admin);

        let commitment = BytesN::from_array(&env, &[0xaa; 32]);
        assert!(!client.is_member(&commitment));

        client.add_member(&admin, &commitment);
        assert!(client.is_member(&commitment));
        assert_eq!(client.member_count(), 1);
    }

    #[test]
    fn test_add_member_already_listed() {
        let (env, admin, client) = setup();
        client.init(&admin);

        let commitment = BytesN::from_array(&env, &[0xaa; 32]);
        client.add_member(&admin, &commitment);
        assert_eq!(
            client.try_add_member(&admin, &commitment),
            Err(Ok(AspError::AlreadyListed))
        );
    }

    #[test]
    fn test_add_member_conflict_with_denied() {
        let (env, admin, client) = setup();
        client.init(&admin);

        let commitment = BytesN::from_array(&env, &[0xaa; 32]);
        client.add_denied(&admin, &commitment);
        assert_eq!(
            client.try_add_member(&admin, &commitment),
            Err(Ok(AspError::Conflict))
        );
    }

    #[test]
    fn test_remove_member() {
        let (env, admin, client) = setup();
        client.init(&admin);

        let commitment = BytesN::from_array(&env, &[0xaa; 32]);
        client.add_member(&admin, &commitment);
        assert!(client.is_member(&commitment));

        client.remove_member(&admin, &commitment);
        assert!(!client.is_member(&commitment));
        assert_eq!(client.member_count(), 0);
    }

    #[test]
    fn test_remove_member_not_found() {
        let (env, admin, client) = setup();
        client.init(&admin);

        let commitment = BytesN::from_array(&env, &[0xaa; 32]);
        assert_eq!(
            client.try_remove_member(&admin, &commitment),
            Err(Ok(AspError::NotFound))
        );
    }

    #[test]
    fn test_add_and_remove_denied() {
        let (env, admin, client) = setup();
        client.init(&admin);

        let commitment = BytesN::from_array(&env, &[0xbb; 32]);
        assert!(!client.is_denied(&commitment));

        client.add_denied(&admin, &commitment);
        assert!(client.is_denied(&commitment));
        assert_eq!(client.denied_count(), 1);

        client.remove_denied(&admin, &commitment);
        assert!(!client.is_denied(&commitment));
        assert_eq!(client.denied_count(), 0);
    }

    #[test]
    fn test_add_denied_conflict_with_member() {
        let (env, admin, client) = setup();
        client.init(&admin);

        let commitment = BytesN::from_array(&env, &[0xaa; 32]);
        client.add_member(&admin, &commitment);
        assert_eq!(
            client.try_add_denied(&admin, &commitment),
            Err(Ok(AspError::Conflict))
        );
    }

    #[test]
    fn test_not_admin_rejected() {
        let (env, admin, client) = setup();
        client.init(&admin);

        let not_admin = Address::generate(&env);
        let commitment = BytesN::from_array(&env, &[0xaa; 32]);
        assert_eq!(
            client.try_add_member(&not_admin, &commitment),
            Err(Ok(AspError::NotAdmin))
        );
    }
}
