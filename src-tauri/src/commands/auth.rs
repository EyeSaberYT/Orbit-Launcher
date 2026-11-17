//! Authentication commands.

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;

use crate::core::auth::microsoft::{self, AuthRequest};
use crate::core::auth::{Account, AccountKind, AccountStore};
use crate::core::config;
use crate::error::{LauncherError, Result};
use crate::state::AppState;

/// Accounts exposed to the UI. Tokens are stripped.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicAccount {
    pub uuid: String,
    pub username: String,
    pub kind: AccountKind,
    pub skin_url: Option<String>,
    pub active: bool,
}

fn public(store: &AccountStore) -> Vec<PublicAccount> {
    store
        .accounts
        .iter()
        .map(|a| PublicAccount {
            uuid: a.uuid.clone(),
            username: a.username.clone(),
            kind: a.kind,
            skin_url: a.skin_url.clone(),
            active: store.active.as_deref() == Some(a.uuid.as_str()),
        })
        .collect()
}

/// Back-fill skin urls that older builds (or an earlier sign-in) never saved.
///
/// Best effort: a failed lookup simply keeps the placeholder in place until the
/// next token refresh supplies the texture. Lookups run concurrently behind a
/// single deadline each, so a whole batch costs one timeout rather than N of
/// them — the account list must never wait on a slow or offline network.
async fn fill_missing_skins(state: &AppState) {
    let pending: Vec<Account> = {
        let store = state.accounts.read().await;
        store
            .accounts
            .iter()
            .filter(|account| account.skin_url.is_none())
            .cloned()
            .collect()
    };
    if pending.is_empty() {
        return;
    }

    let lookups = pending.iter().map(|account| async move {
        let skin = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            microsoft::skin_for_account(&state.http, account),
        )
        .await
        .ok()
        .and_then(|outcome| outcome.ok())
        .flatten();

        (account.uuid.as_str(), skin)
    });
    let results = futures::future::join_all(lookups).await;

    let updates: Vec<(&str, String)> = results
        .into_iter()
        .filter_map(|(uuid, skin)| skin.map(|skin| (uuid, skin)))
        .collect();
    if updates.is_empty() {
        return;
    }

    // One lock and one write for the whole batch instead of one per account.
    let mut store = state.accounts.write().await;
    let mut changed = false;
    for (uuid, skin) in updates {
        let Some(existing) = store.accounts.iter_mut().find(|a| a.uuid == uuid) else {
            continue;
        };
        // Still unfilled? A concurrent sign-in or refresh may have got there
        // first while we were on the network, and theirs is just as fresh.
        if existing.skin_url.is_none() {
            existing.skin_url = Some(skin);
            changed = true;
        }
    }

    if changed {
        if let Err(error) = store.save(&state.paths) {
            // Only cosmetic: a failed write costs one extra lookup next
            // launch, so report it without failing the account list.
            log::warn!("failed to persist back-filled skin urls: {error}");
        }
    }
}

#[tauri::command]
pub async fn auth_accounts(state: State<'_, AppState>) -> Result<Vec<PublicAccount>> {
    fill_missing_skins(state.inner()).await;
    let store = state.accounts.read().await;
    Ok(public(&store))
}

/// Label of the Microsoft sign-in window, so a second sign-in replaces it.
const LOGIN_WINDOW: &str = "microsoft-login";

/// How long the sign-in window waits for the player before giving up.
const LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15 * 60);

fn cancelled() -> LauncherError {
    LauncherError::Auth("Sign-in was cancelled.".into())
}

/// Open Microsoft's sign-in page in its own window and wait for its code.
///
/// The window shows Microsoft's real pages (with their real address), runs in a
/// private session so nothing is remembered between sign-ins, and has no access
/// to the launcher's commands. It is stopped as soon as Microsoft redirects back,
/// so the code never reaches any server, then closed.
async fn sign_in_window(app: &AppHandle, request: &Arc<AuthRequest>) -> Result<String> {
    if let Some(stale) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = stale.destroy();
    }

    // Filled exactly once: by the redirect, or by the player closing the window.
    let (tx, rx) = oneshot::channel::<Result<String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let send = |tx: &Arc<Mutex<Option<oneshot::Sender<Result<String>>>>>, result: Result<String>| {
        if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = tx.send(result);
        }
    };

    let nav_tx = tx.clone();
    let nav_request = request.clone();
    let mut builder = WebviewWindowBuilder::new(app, LOGIN_WINDOW, WebviewUrl::External(request.url.clone()))
        .title("Sign in with Microsoft")
        .inner_size(500.0, 680.0)
        .min_inner_size(400.0, 500.0)
        .center()
        .focused(true)
        .incognito(true)
        .on_navigation(move |url| match nav_request.redirect_result(url) {
            Some(result) => {
                send(&nav_tx, result);
                false
            }
            // Microsoft's pages are all https; refuse anything else outright.
            None => url.scheme() == "https" || url.scheme() == "about",
        });
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| LauncherError::Auth(e.to_string()))?;
    }
    let window = builder
        .build()
        .map_err(|e| LauncherError::Auth(format!("Couldn't open the Microsoft sign-in window: {e}")))?;

    let close_tx = tx.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            send(&close_tx, Err(cancelled()));
        }
    });

    let outcome = tokio::time::timeout(LOGIN_TIMEOUT, rx).await;
    let _ = window.destroy();
    match outcome {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(cancelled()),
        Err(_) => Err(LauncherError::Auth("Sign-in timed out. Please try again.".into())),
    }
}

/// Sign in with Microsoft through an in-app Microsoft sign-in window.
///
/// Resolves once the player has signed in there (or fails when they close it).
#[tauri::command]
pub async fn auth_login_microsoft(app: AppHandle, state: State<'_, AppState>) -> Result<PublicAccount> {
    let client_id = config::microsoft_client_id();
    if client_id.trim().is_empty() {
        return Err(LauncherError::Auth(
            "This build has no Microsoft client id compiled in, so sign-in is unavailable."
                .into(),
        ));
    }

    let request = Arc::new(AuthRequest::new(client_id));
    let code = sign_in_window(&app, &request).await?;
    let account = microsoft::login(&state.http, client_id, &request, &code).await?;

    let mut store = state.accounts.write().await;
    store.active = Some(account.uuid.clone());
    store.upsert(account.clone());
    store.save(&state.paths)?;

    Ok(PublicAccount {
        uuid: account.uuid,
        username: account.username,
        kind: account.kind,
        skin_url: account.skin_url,
        active: true,
    })
}

/// Close the Microsoft sign-in window, which ends a pending sign-in as cancelled.
#[tauri::command]
pub async fn auth_cancel_login(app: AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = window.destroy();
    }
    Ok(())
}

#[tauri::command]
pub async fn auth_set_active(state: State<'_, AppState>, uuid: String) -> Result<Vec<PublicAccount>> {
    let mut store = state.accounts.write().await;
    if !store.accounts.iter().any(|a| a.uuid == uuid) {
        return Err(LauncherError::NotFound("that account".into()));
    }
    store.active = Some(uuid);
    store.save(&state.paths)?;
    Ok(public(&store))
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>, uuid: String) -> Result<Vec<PublicAccount>> {
    let mut store = state.accounts.write().await;
    store.accounts.retain(|a| a.uuid != uuid);
    if store.active.as_deref() == Some(uuid.as_str()) {
        store.active = store.accounts.first().map(|a| a.uuid.clone());
    }
    store.save(&state.paths)?;
    Ok(public(&store))
}

async fn stored_active(state: &AppState) -> Result<Account> {
    let store = state.accounts.read().await;
    store
        .active_account()
        .cloned()
        .ok_or_else(|| LauncherError::Auth("No account selected. Sign in first.".into()))
}

/// Return the active account, refreshing its token when needed.
pub async fn active_account(state: &AppState) -> Result<Account> {
    let account = stored_active(state).await?;
    if !account.is_expired() {
        return Ok(account);
    }

    // One refresh at a time. Whoever waited for the lock re-reads the store:
    // the refresh that just finished has usually already renewed this account.
    let _refreshing = state.token_refresh.lock().await;
    let account = stored_active(state).await?;
    if !account.is_expired() {
        return Ok(account);
    }

    log::info!("refreshing the Minecraft token for {}", account.username);
    let refreshed = match microsoft::refresh_account(&state.http, config::microsoft_client_id(), &account).await {
        Ok(refreshed) => refreshed,
        Err(error) => {
            log::warn!("couldn't refresh the token for {}: {error}", account.username);
            return Err(error);
        }
    };
    {
        // Signed out while the refresh was on the network: keep it signed out.
        let mut store = state.accounts.write().await;
        if !store.update(refreshed.clone()) {
            return Err(LauncherError::Auth("That account was signed out. Sign in again.".into()));
        }
        store.save(&state.paths)?;
    }
    log::info!("token for {} renewed", refreshed.username);
    Ok(refreshed)
}

#[tauri::command]
pub async fn auth_current(state: State<'_, AppState>) -> Result<Option<PublicAccount>> {
    let store = state.accounts.read().await;
    Ok(store.active_account().map(|a| PublicAccount {
        uuid: a.uuid.clone(),
        username: a.username.clone(),
        kind: a.kind,
        skin_url: a.skin_url.clone(),
        active: true,
    }))
}
