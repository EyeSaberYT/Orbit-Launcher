//! Friends, through Orbit Client's cosmetics server (the same server and sign-in Orbit Client
//! uses, so friends, requests and messages are shared between the launcher and the game).
//!
//! The server is reached over HTTPS only, at [`SERVER`] (Cloudflare in front of it). Signing in works
//! like joining a Minecraft server: a one-time challenge, Mojang's `join` with the account's token,
//! then the server checks it with Mojang and hands out its own token. No Microsoft token ever
//! reaches the friends server.
//!
//! What is signed with Mojang is never the server's challenge as given: see [`sign_in_id`].

use std::time::Duration;

use serde_json::Value;
use sha1::{Digest, Sha1};
use tokio::sync::Mutex;

use super::auth::Account;
use crate::error::{LauncherError, Result};

/// The friends and cosmetics server. HTTPS only: over plain HTTP anyone on the player's network
/// could read the messages and the sign-in, or change the challenge.
const SERVER: &str = "https://orbit-social.minearcade.org";
const MOJANG_JOIN: &str = "https://sessionserver.mojang.com/session/minecraft/join";
/// Fixed start of what is signed with Mojang; the server and Orbit Client use the same.
const SIGN_IN_PREFIX: &str = "orbit-sign-in-v2:";

/// The sign-in for one account.
#[derive(Default)]
pub struct Social {
    /// (account uuid, server, token)
    token: Mutex<Option<(String, String, String)>>,
}

impl Social {
    async fn token(&self, http: &reqwest::Client, server: &str, account: &Account) -> Result<String> {
        let mut token = self.token.lock().await;
        if let Some((uuid, for_server, value)) = token.as_ref() {
            if uuid == &account.uuid && for_server == server {
                return Ok(value.clone());
            }
        }
        let value = sign_in(http, server, account).await?;
        *token = Some((account.uuid.clone(), server.to_string(), value.clone()));
        Ok(value)
    }

    /// POST `path` as `account`; signs in again once when the server says the token expired.
    pub async fn call(&self, http: &reqwest::Client, account: &Account, path: &str, body: Option<String>) -> Result<Value> {
        let server = SERVER;
        for attempt in 0..2 {
            let token = self.token(http, server, account).await?;
            let mut request = http
                .post(format!("{server}{path}"))
                .timeout(Duration::from_secs(10))
                .bearer_auth(&token)
                .header("Content-Type", "text/plain; charset=utf-8");
            if let Some(body) = &body {
                request = request.body(body.clone());
            }
            let response = request.send().await.map_err(|_| unreachable_server())?;
            let status = response.status();
            if status.as_u16() == 401 && attempt == 0 {
                *self.token.lock().await = None;
                continue;
            }
            let text = response.text().await.unwrap_or_default();
            let json: Value = match serde_json::from_str(&text) {
                Ok(json) => json,
                // An old cosmetics server without these routes answers with a 404 page.
                Err(_) if status.as_u16() == 404 => return Err(LauncherError::msg("Orbit's friends server needs an update.")),
                Err(_) => return Err(LauncherError::msg(format!("Friends server error ({status})"))),
            };
            if !status.is_success() {
                let message = json.get("error").and_then(Value::as_str).unwrap_or("Friends server error");
                return Err(LauncherError::msg(message.to_string()));
            }
            return Ok(json);
        }
        Err(LauncherError::msg("Couldn't sign in to Orbit's friends server."))
    }
}

fn unreachable_server() -> LauncherError {
    LauncherError::msg("Can't reach Orbit's friends server.")
}

/// What the account tells Mojang it joined: SHA-1 of a fixed prefix, the server's challenge and a
/// random number of the launcher's own, as 40 hex digits.
///
/// Signing the challenge as given would let whoever answers it (a fake server, or anyone between the
/// player and the server) pass on the handshake value of a real Minecraft server they are joining
/// under the player's name, and Mojang would then let them into that server as the player. Mixing
/// in a number only the launcher knows means nobody else can choose the result.
fn sign_in_id(challenge: &str, client: &str) -> String {
    let digest = Sha1::digest(format!("{SIGN_IN_PREFIX}{challenge}:{client}").as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

async fn sign_in(http: &reqwest::Client, server: &str, account: &Account) -> Result<String> {
    let challenge: Value = http
        .get(format!("{server}/auth/challenge"))
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|_| unreachable_server())?
        .json()
        .await
        .map_err(|_| LauncherError::msg("Friends server error (sign-in)."))?;
    let server_id = challenge
        .get("serverId")
        .and_then(Value::as_str)
        .ok_or_else(|| LauncherError::msg("Friends server error (sign-in)."))?
        .to_string();
    // The server's challenges are 32 hex digits; anything else isn't one.
    if server_id.len() != 32 || !server_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(LauncherError::msg("Friends server error (sign-in)."));
    }
    let client = uuid::Uuid::new_v4().simple().to_string();
    let signed = sign_in_id(&server_id, &client);

    // Tell Mojang this account is joining `signed`; the friends server works out the same value and asks Mojang.
    let joined = http
        .post(MOJANG_JOIN)
        .timeout(Duration::from_secs(10))
        .json(&serde_json::json!({
            "accessToken": account.access_token,
            "selectedProfile": account.uuid.replace('-', ""),
            "serverId": signed,
        }))
        .send()
        .await
        .map_err(|_| LauncherError::msg("Couldn't reach Mojang to sign in to Orbit's friends server."))?;
    if !joined.status().is_success() {
        return Err(LauncherError::Auth("Mojang refused the sign-in. Sign in to your account again.".into()));
    }

    let verified = http
        .post(format!("{server}/auth/verify"))
        .query(&[("name", account.username.as_str()), ("serverId", server_id.as_str()), ("client", client.as_str())])
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|_| unreachable_server())?;
    if !verified.status().is_success() {
        return Err(LauncherError::msg(format!("Orbit's friends server refused the sign-in ({}).", verified.status())));
    }
    let json: Value = verified.json().await.map_err(|_| LauncherError::msg("Friends server error (sign-in)."))?;
    json.get("token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| LauncherError::msg("Friends server error (sign-in)."))
}

#[cfg(test)]
mod tests {
    use super::{sign_in_id, SERVER};

    #[test]
    fn sign_in_value_matches_the_server_and_orbit_client() {
        // The same value the cosmetics server's own test expects.
        assert_eq!(
            sign_in_id("00112233445566778899aabbccddeeff", "ffeeddccbbaa99887766554433221100"),
            "d8229ecec4e7b41d986fe713523da24c75ccd438"
        );
    }

    #[test]
    fn the_friends_server_is_only_reached_over_https() {
        assert!(SERVER.starts_with("https://"));
    }
}
