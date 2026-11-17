//! Microsoft → Xbox Live → Minecraft authentication chain.
//!
//! Sign-in works the way the Modrinth App's does: the launcher opens Microsoft's
//! own sign-in page in a window of its own, the player signs in there, and the
//! window closes by itself once Microsoft redirects back. Under the hood this is
//! the **OAuth 2.0 authorization code flow with PKCE** (no client secret): the
//! launcher catches the redirect inside that window and never sees the password.
//!
//! The chain is:
//!
//! ```text
//! Microsoft identity (authorization code + PKCE)
//!   └─ Xbox Live user token (XBL)
//!        └─ XSTS token (relying party: rp://api.minecraftservices.com/)
//!             └─ Minecraft services token
//!                  └─ Minecraft profile (uuid + name)
//! ```

use serde::Deserialize;

use super::{Account, AccountKind};
use crate::error::{LauncherError, Result};

/// Microsoft identity authority used for sign-in.
///
/// This must be `consumers`. The `XboxLive.signin` scope only exists for
/// personal Microsoft accounts; requesting it against a directory id or
/// `common` fails with AADSTS650053 ("scope ... doesn't exist on the resource
/// Microsoft Graph"). The app registration must therefore be configured to
/// allow personal Microsoft accounts (see the README), and users must sign in
/// with the personal account that owns Minecraft.
const TENANT: &str = "consumers";

fn authorize_url() -> String {
    format!("https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/authorize")
}

/// Where Microsoft sends the player after signing in. It is never actually
/// loaded: the sign-in window stops on it and reads the code from the url.
///
/// This is Microsoft's standard redirect for desktop apps. It must be enabled on
/// the Azure app registration (Authentication → Mobile and desktop applications).
pub const REDIRECT_URI: &str = "https://login.microsoftonline.com/common/oauth2/nativeclient";

fn token_url() -> String {
    format!("https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token")
}
const XBL_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";
const MC_ENTITLEMENTS_URL: &str = "https://api.minecraftservices.com/entitlements/mcstore";

const SCOPE: &str = "XboxLive.signin offline_access";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default = "default_expires")]
    expires_in: i64,
}

fn default_expires() -> i64 {
    3600
}

#[derive(Deserialize)]
struct OAuthError {
    error: String,
    #[serde(default)]
    error_description: String,
}

/// XSTS failures: `{"Identity":"0","XErr":2148916233,"Message":"","Redirect":"…"}`.
/// Not an OAuth error body, so it has its own (all optional) shape.
#[derive(Deserialize, Default)]
struct XstsError {
    #[serde(rename = "XErr", default)]
    xerr: Option<u64>,
}

/// The player-facing explanation for an XSTS `XErr` code.
fn xsts_message(xerr: Option<u64>) -> String {
    match xerr {
        Some(2148916233) => {
            "This Microsoft account has no Xbox profile yet. Sign in at xbox.com once, then try again.".into()
        }
        Some(2148916227) => "This account is banned from Xbox Live.".into(),
        Some(2148916229) => {
            "Parental controls on this account block online play. A parent can change this at account.microsoft.com/family."
                .into()
        }
        Some(2148916235) => "Xbox Live is not available in your region.".into(),
        Some(2148916236) | Some(2148916237) => {
            "This account needs adult verification before it can play Minecraft.".into()
        }
        Some(2148916238) => {
            "This is a child account. Ask a family organiser to add it to a Microsoft Family group.".into()
        }
        Some(code) => format!("Xbox Live rejected the sign-in (error {code}). Please try again later."),
        None => "Xbox Live rejected the sign-in. Please try again later.".into(),
    }
}

#[derive(Deserialize)]
struct XblResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: DisplayClaims,
}

#[derive(Deserialize)]
struct DisplayClaims {
    xui: Vec<Xui>,
}

#[derive(Deserialize)]
struct Xui {
    uhs: String,
}

#[derive(Deserialize)]
struct McTokenResponse {
    access_token: String,
    #[serde(default = "default_expires")]
    expires_in: i64,
}

#[derive(Deserialize)]
struct McProfile {
    id: String,
    name: String,
    #[serde(default)]
    skins: Vec<McSkin>,
}

#[derive(Deserialize)]
struct McSkin {
    state: String,
    url: String,
}

#[derive(Deserialize)]
struct McEntitlements {
    #[serde(default)]
    items: Vec<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Flow steps
// ---------------------------------------------------------------------------

/// One sign-in attempt: the page to open plus the secrets that prove the
/// redirect that comes back belongs to it.
pub struct AuthRequest {
    /// Microsoft's sign-in page for this attempt.
    pub url: url::Url,
    /// Random value echoed back by Microsoft, so a stray redirect is rejected.
    state: String,
    /// PKCE secret: only its hash goes in `url`, so an intercepted code is useless.
    verifier: String,
}

/// Base64url SHA-256 of the verifier (RFC 7636, method `S256`).
fn pkce_challenge(verifier: &str) -> String {
    use base64::Engine;
    use sha2::Digest;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes()))
}

impl AuthRequest {
    /// Step 1: build Microsoft's sign-in page url for a fresh attempt.
    pub fn new(client_id: &str) -> Self {
        // Two v4 uuids come from the OS random source: 64 hex chars, ~244 bits.
        let verifier = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        let state = uuid::Uuid::new_v4().simple().to_string();
        let challenge = pkce_challenge(&verifier);
        let url = url::Url::parse_with_params(
            &authorize_url(),
            &[
                ("client_id", client_id),
                ("response_type", "code"),
                ("response_mode", "query"),
                ("redirect_uri", REDIRECT_URI),
                ("scope", SCOPE),
                ("state", state.as_str()),
                ("code_challenge", challenge.as_str()),
                ("code_challenge_method", "S256"),
                // Always let the player pick (or add) an account.
                ("prompt", "select_account"),
            ],
        )
        .expect("the authorize url is valid");
        Self { url, state, verifier }
    }

    /// Step 2: read a url the sign-in window is about to open.
    ///
    /// `None` while the player is still on Microsoft's pages; once the window
    /// reaches [`REDIRECT_URI`], the authorization code or the reason it failed.
    pub fn redirect_result(&self, url: &url::Url) -> Option<Result<String>> {
        let redirect = url::Url::parse(REDIRECT_URI).expect("the redirect uri is valid");
        if url.scheme() != redirect.scheme() || url.host_str() != redirect.host_str() || url.path() != redirect.path() {
            return None;
        }

        let query = |key: &str| url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned());
        if let Some(error) = query("error") {
            let detail = query("error_description").unwrap_or_default();
            let detail = detail.lines().next().unwrap_or_default().trim();
            return Some(Err(LauncherError::Auth(match error.as_str() {
                "access_denied" => "Sign-in was cancelled.".into(),
                _ if detail.is_empty() => format!("Microsoft sign-in failed ({error})."),
                _ => format!("Microsoft sign-in failed ({error}): {detail}"),
            })));
        }
        if query("state").as_deref() != Some(self.state.as_str()) {
            return Some(Err(LauncherError::Auth(
                "The sign-in response didn't match this sign-in attempt. Please try again.".into(),
            )));
        }
        Some(
            query("code")
                .filter(|code| !code.is_empty())
                .ok_or_else(|| LauncherError::Auth("Microsoft didn't return a sign-in code. Please try again.".into())),
        )
    }
}

/// Step 3: trade the authorization code for Microsoft tokens.
pub async fn exchange_code(
    http: &reqwest::Client,
    client_id: &str,
    request: &AuthRequest,
    code: &str,
) -> Result<(String, Option<String>, i64)> {
    let res = http
        .post(token_url())
        .form(&[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("code_verifier", request.verifier.as_str()),
            ("scope", SCOPE),
        ])
        .send()
        .await?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        log::warn!("Microsoft code exchange failed (HTTP {status}): {body}");
        let err: Option<OAuthError> = serde_json::from_str(&body).ok();
        let detail = err
            .as_ref()
            .map(|e| e.error_description.lines().next().unwrap_or_default().trim().to_string())
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(LauncherError::Auth(format!("Microsoft sign-in failed: {detail}")));
    }

    let token: TokenResponse = res.json().await?;
    Ok((token.access_token, token.refresh_token, token.expires_in))
}

/// How many times a refresh is attempted when the connection itself fails
/// (as the Modrinth App does): a dropped Wi-Fi packet is not a lost sign-in.
const REFRESH_ATTEMPTS: u32 = 4;

/// Exchange a refresh token for a fresh Microsoft access token.
///
/// Only `invalid_grant` means the sign-in is really over (revoked, expired after
/// 90 days unused, password changed); every other failure is reported as it is,
/// so a temporary outage doesn't look like being signed out.
pub async fn refresh_token(
    http: &reqwest::Client,
    client_id: &str,
    refresh_token: &str,
) -> Result<(String, Option<String>, i64)> {
    let mut attempt = 1;
    let res = loop {
        let sent = http
            .post(token_url())
            .form(&[
                ("client_id", client_id),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("scope", SCOPE),
            ])
            .send()
            .await;
        match sent {
            Ok(res) => break res,
            Err(error) if (error.is_connect() || error.is_timeout()) && attempt < REFRESH_ATTEMPTS => {
                log::warn!("Microsoft token refresh attempt {attempt} couldn't connect: {error}");
                tokio::time::sleep(std::time::Duration::from_millis(500 * u64::from(attempt))).await;
                attempt += 1;
            }
            Err(error) => return Err(error.into()),
        }
    };

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        let err: Option<OAuthError> = serde_json::from_str(&body).ok();
        // The description starts with an AADSTS code that says exactly why; log
        // it in full, show its first line.
        log::warn!("Microsoft token refresh failed (HTTP {status}): {body}");
        let detail = err
            .as_ref()
            .map(|e| e.error_description.lines().next().unwrap_or_default().trim().to_string())
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(LauncherError::Auth(match err.as_ref().map(|e| e.error.as_str()) {
            Some("invalid_grant") => format!("Microsoft ended this sign-in, so please sign in again. ({detail})"),
            Some(code) => format!("Microsoft couldn't renew the sign-in ({code}): {detail}"),
            None => format!("Microsoft couldn't renew the sign-in: {detail}"),
        }));
    }

    let token: TokenResponse = res.json().await?;
    Ok((token.access_token, token.refresh_token, token.expires_in))
}

/// Step 4: trade the Microsoft access token for an XSTS token and a Minecraft
/// services token.
pub async fn xbox_chain(
    http: &reqwest::Client,
    ms_access_token: &str,
) -> Result<(String, i64)> {
    // 3a. Xbox Live user token.
    let xbl_res = http
        .post(XBL_URL)
        .json(&serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={ms_access_token}"),
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT",
        }))
        .send()
        .await?;

    // Xbox Live returns a non-2xx body with a different shape on failure, so
    // check the status before decoding (otherwise it surfaces as a confusing
    // "error decoding response body" network error).
    if !xbl_res.status().is_success() {
        let status = xbl_res.status();
        let body = xbl_res.text().await.unwrap_or_default();
        return Err(LauncherError::Auth(format!(
            "Xbox Live rejected the Microsoft sign-in (HTTP {status}). {body}"
        )));
    }
    let xbl: XblResponse = xbl_res.json().await?;

    let uhs = xbl
        .display_claims
        .xui
        .first()
        .map(|x| x.uhs.clone())
        .ok_or_else(|| LauncherError::Auth("Xbox Live returned no user hash.".into()))?;

    // 3b. XSTS token.
    let xsts_res = http
        .post(XSTS_URL)
        .json(&serde_json::json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl.token],
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT",
        }))
        .send()
        .await?;

    if !xsts_res.status().is_success() {
        let body = xsts_res.text().await.unwrap_or_default();
        let err: XstsError = serde_json::from_str(&body).unwrap_or_default();
        return Err(LauncherError::Auth(xsts_message(err.xerr)));
    }

    let xsts: XblResponse = xsts_res.json().await?;

    // 3c. Minecraft services token.
    let mc_res = http
        .post(MC_LOGIN_URL)
        .json(&serde_json::json!({
            "identityToken": format!("XBL3.0 x={uhs};{}", xsts.token),
        }))
        .send()
        .await?;

    // Minecraft services returns a non-2xx body with a different shape on
    // failure, so check the status before decoding. This is also where a brand
    // new Azure app registration is rejected until Mojang allow-lists it.
    if !mc_res.status().is_success() {
        let status = mc_res.status();
        let body = mc_res.text().await.unwrap_or_default();

        if body.contains("Invalid app registration") {
            return Err(LauncherError::Auth(
                "This build's Azure app registration hasn't been allow-listed by Mojang, so \
                 the final Minecraft login step is blocked (HTTP 403, \"Invalid app \
                 registration\"). The client id needs approval at \
                 https://aka.ms/mce-reviewappid."
                    .into(),
            ));
        }
        return Err(LauncherError::Auth(format!(
            "Minecraft services rejected the login (HTTP {status}). {body}"
        )));
    }
    let mc: McTokenResponse = mc_res.json().await?;

    Ok((mc.access_token, mc.expires_in))
}

/// Step 5: fetch the player's Minecraft profile (uuid + username).
pub async fn fetch_profile(
    http: &reqwest::Client,
    mc_access_token: &str,
) -> Result<(String, String, Option<String>)> {
    let res = http
        .get(MC_PROFILE_URL)
        .bearer_auth(mc_access_token)
        .send()
        .await?;

    if res.status() == reqwest::StatusCode::NOT_FOUND {
        // No profile: either the game isn't owned, or it is (e.g. through Game Pass)
        // but no player name has been chosen yet. `login` tells these apart when the
        // entitlement check could answer.
        return Err(LauncherError::Auth(
            "This Microsoft account has no Minecraft: Java Edition profile. If you own the game              (including through PC Game Pass), sign in once at minecraft.net and choose a              player name, then try again."
                .into(),
        ));
    }
    if !res.status().is_success() {
        return Err(LauncherError::Auth(
            "Minecraft services rejected the login. Please try again.".into(),
        ));
    }

    let profile: McProfile = res.json().await?;
    let skin_url = profile
        .skins
        .iter()
        .find(|s| s.state == "ACTIVE")
        .map(|s| s.url.as_str())
        .or_else(|| profile.skins.first().map(|s| s.url.as_str()))
        .map(normalize_texture_url);
    Ok((dashify_uuid(&profile.id), profile.name, skin_url))
}

/// Mojang hands back `http://textures.minecraft.net/…`, but the app's CSP only
/// allows `https://` for that host, so normalise before the url is stored or
/// handed to the webview.
pub(crate) fn normalize_texture_url(url: &str) -> String {
    match url.strip_prefix("http://textures.minecraft.net") {
        Some(rest) => format!("https://textures.minecraft.net{rest}"),
        None => url.to_string(),
    }
}

/// Look up a stored account's skin, back-filling it when missing.
///
/// Accounts saved by builds that didn't record a texture url (or signed in
/// while the profile still reported none) keep showing a placeholder until this
/// runs, so the accounts command fills the gap on read. Deliberately best
/// effort: a missing skin never breaks sign-in, and it is refreshed again on
/// the next token refresh.
pub async fn skin_for_account(
    http: &reqwest::Client,
    account: &Account,
) -> Result<Option<String>> {
    if let Some(skin) = account.skin_url.as_ref() {
        return Ok(Some(skin.clone()));
    }
    // An expired token would only produce a 401; the next refresh fills it in.
    if account.is_expired() {
        return Ok(None);
    }

    let (_, _, skin) = fetch_profile(http, &account.access_token).await?;
    Ok(skin)
}

/// Whether the account holds any Minecraft entitlement: `Some(true)`/`Some(false)` when
/// the service answered, `None` when it couldn't say (an error status or an odd body).
pub async fn check_entitlements(http: &reqwest::Client, mc_access_token: &str) -> Result<Option<bool>> {
    let res = http
        .get(MC_ENTITLEMENTS_URL)
        .bearer_auth(mc_access_token)
        .send()
        .await?;

    if !res.status().is_success() {
        log::warn!("entitlement check returned HTTP {}", res.status());
        return Ok(None);
    }
    Ok(res.json::<McEntitlements>().await.ok().map(|e| !e.items.is_empty()))
}

// ---------------------------------------------------------------------------
// High level helpers
// ---------------------------------------------------------------------------

/// Finish a sign-in once the window has handed back its authorization code,
/// returning a ready-to-use [`Account`].
pub async fn login(
    http: &reqwest::Client,
    client_id: &str,
    request: &AuthRequest,
    code: &str,
) -> Result<Account> {
    let (ms_token, refresh, _) = exchange_code(http, client_id, request, code).await?;

    let (mc_token, expires_in) = xbox_chain(http, &ms_token).await?;
    let owns = check_entitlements(http, &mc_token).await.ok().flatten();
    let (uuid, name, skin_url) = match fetch_profile(http, &mc_token).await {
        Ok(profile) => profile,
        // The service said plainly that nothing is owned: say that, not "pick a name".
        Err(LauncherError::Auth(_)) if owns == Some(false) => {
            return Err(LauncherError::Auth(
                "This Microsoft account doesn't own Minecraft: Java Edition.".into(),
            ))
        }
        Err(error) => return Err(error),
    };

    Ok(Account {
        kind: AccountKind::Microsoft,
        username: name,
        uuid,
        access_token: mc_token,
        expires_at: chrono::Utc::now().timestamp() + expires_in,
        refresh_token: refresh,
        skin_url,
    })
}

/// Re-authenticate a stored Microsoft account using its refresh token.
pub async fn refresh_account(
    http: &reqwest::Client,
    client_id: &str,
    account: &Account,
) -> Result<Account> {
    let refresh = account
        .refresh_token
        .clone()
        .ok_or_else(|| LauncherError::Auth("No refresh token stored for this account.".into()))?;

    let (ms_token, new_refresh, _) = refresh_token(http, client_id, &refresh).await?;
    let (mc_token, expires_in) = xbox_chain(http, &ms_token).await?;
    let (uuid, name, skin_url) = fetch_profile(http, &mc_token).await?;

    Ok(Account {
        kind: AccountKind::Microsoft,
        username: name,
        uuid,
        access_token: mc_token,
        expires_at: chrono::Utc::now().timestamp() + expires_in,
        refresh_token: new_refresh.or(account.refresh_token.clone()),
        skin_url: skin_url.or_else(|| account.skin_url.clone()),
    })
}

/// Insert dashes into a 32-char dashless UUID.
pub fn dashify_uuid(raw: &str) -> String {
    if raw.len() != 32 {
        return raw.to_string();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &raw[0..8],
        &raw[8..12],
        &raw[12..16],
        &raw[16..20],
        &raw[20..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xsts_error_codes_are_read_from_the_real_body_shape() {
        let body = r#"{"Identity":"0","XErr":2148916233,"Message":"","Redirect":"https://start.ui.xboxlive.com/CreateAccount"}"#;
        let err: XstsError = serde_json::from_str(body).unwrap();
        assert_eq!(err.xerr, Some(2148916233));
        assert!(xsts_message(err.xerr).contains("no Xbox profile"));
        assert!(xsts_message(Some(2148916229)).contains("Parental controls"));
        // An unknown or unreadable body still gives a message, never a panic.
        let empty: XstsError = serde_json::from_str("{}").unwrap();
        assert!(xsts_message(empty.xerr).contains("rejected"));
    }

    #[test]
    fn texture_urls_are_upgraded_to_https() {
        // The webview's CSP only allows https for this host.
        assert_eq!(
            normalize_texture_url("http://textures.minecraft.net/texture/abc"),
            "https://textures.minecraft.net/texture/abc"
        );
        assert_eq!(
            normalize_texture_url("https://textures.minecraft.net/texture/abc"),
            "https://textures.minecraft.net/texture/abc"
        );
        // Anything else is left exactly as received.
        assert_eq!(
            normalize_texture_url("http://example.test/x"),
            "http://example.test/x"
        );
    }

    #[test]
    fn pkce_challenge_matches_the_rfc_example() {
        // RFC 7636, appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn only_the_redirect_with_the_right_state_yields_a_code() {
        let request = AuthRequest::new("client");
        assert!(request.url.as_str().contains("code_challenge_method=S256"));
        assert!(!request.url.as_str().contains(&request.verifier));

        // Microsoft's own pages are left alone.
        let page = url::Url::parse("https://login.live.com/oauth20_authorize.srf?x=1").unwrap();
        assert!(request.redirect_result(&page).is_none());

        let good = url::Url::parse(&format!("{REDIRECT_URI}?code=abc&state={}", request.state)).unwrap();
        assert_eq!(request.redirect_result(&good).unwrap().unwrap(), "abc");

        let forged = url::Url::parse(&format!("{REDIRECT_URI}?code=abc&state=other")).unwrap();
        assert!(request.redirect_result(&forged).unwrap().is_err());

        let denied = url::Url::parse(&format!("{REDIRECT_URI}?error=access_denied&state={}", request.state)).unwrap();
        let message = request.redirect_result(&denied).unwrap().unwrap_err().to_string();
        assert!(message.contains("cancelled"));
    }
}
