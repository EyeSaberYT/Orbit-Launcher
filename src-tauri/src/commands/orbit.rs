//! Orbit Client: the launcher's own client, as a managed Fabric instance.
//!
//! One instance carries the [`TAG`] tag. Installing creates it (Fabric on
//! [`GAME_VERSION`], Fabric API from Modrinth) or repairs what's missing, and
//! every launch of it first swaps in the newest Orbit Client jar from the
//! GitHub releases of `EyeSaberYT/OrbitClient`. Offline, it plays the jar it has.
//!
//! While the launcher is open it also looks for a new release by itself
//! ([`orbit_client_update_all`]) and updates every instance that has the mod.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

use crate::commands::instance::{instance_create, instance_install_loader, CreateInstanceArgs};
use crate::commands::modrinth::modrinth_install;
use crate::core::download::{download_many, get_json, DownloadSpec};
use crate::core::instance::{game_dir, Instance, InstalledProject, LoaderKind};
use crate::core::path_security::{destination_is_within, is_safe_filename};
use crate::error::{LauncherError, Result};
use crate::state::AppState;

/// Marks the managed instance.
pub const TAG: &str = "orbit-client";
/// Marks an instance whose player removed Orbit Client: it isn't put back.
pub const OPT_OUT_TAG: &str = "no-orbit-client";
/// The Minecraft version Orbit Client is built for.
pub const GAME_VERSION: &str = "1.21.11";
/// The id the jar is recorded under in `installed_projects`. Not a Modrinth id:
/// update checks skip it, and launches update it instead.
pub const PROJECT_ID: &str = "orbit-client";
const FABRIC_API: &str = "P7dR8mSH";
const LATEST_RELEASE: &str = "https://api.github.com/repos/EyeSaberYT/OrbitClient/releases/latest";
/// The Orbit icon the launcher ships with, which is also the mod's icon.
const ICON: &[u8] = include_bytes!("../../icons/128x128.png");

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    /// `sha256:<hex>`, which GitHub publishes for release assets.
    #[serde(default)]
    digest: Option<String>,
}

/// What the Home page needs: the managed instance, if any, and its jar version.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbitStatus {
    pub instance_id: Option<String>,
    pub version: Option<String>,
}

pub fn is_orbit(instance: &Instance) -> bool {
    instance.tags.iter().any(|t| t == TAG)
}

/// The release's mod jar for `game_version`: `orbit-client-<version>+<game version>.jar` from
/// multi-version releases, else a single `orbit-client-<version>.jar`. Never a sources jar.
fn pick_asset<'a>(release: &'a Release, game_version: &str) -> Option<&'a Asset> {
    let jars = || {
        release.assets.iter().filter(|a| {
            a.name.starts_with("orbit-client-") && a.name.ends_with(".jar") && !a.name.ends_with("-sources.jar")
        })
    };
    let suffix = format!("+{game_version}.jar");
    jars()
        .find(|a| a.name.ends_with(&suffix))
        .or_else(|| jars().find(|a| !a.name.contains('+')))
}

fn installed_version(instance: &Instance) -> Option<&InstalledProject> {
    instance.installed_projects.iter().find(|p| p.project_id == PROJECT_ID)
}

#[tauri::command]
pub async fn orbit_client_status(state: State<'_, AppState>) -> Result<OrbitStatus> {
    let store = state.instances.read().await;
    let instance = store.instances.iter().find(|i| is_orbit(i));
    Ok(OrbitStatus {
        instance_id: instance.map(|i| i.id.clone()),
        version: instance.and_then(installed_version).map(|p| p.version_id.clone()),
    })
}

/// Create the Orbit Client instance, or repair it: Fabric, Fabric API and the
/// newest Orbit Client jar. Safe to run again at any time.
#[tauri::command]
pub async fn orbit_client_install(app: AppHandle, state: State<'_, AppState>) -> Result<Instance> {
    let existing = state.instances.read().await.instances.iter().find(|i| is_orbit(i)).map(|i| i.id.clone());
    let id = match existing {
        Some(id) => id,
        None => {
            let created = instance_create(
                app.clone(),
                state.clone(),
                CreateInstanceArgs {
                    name: "Orbit Client".into(),
                    game_version: GAME_VERSION.into(),
                    loader: LoaderKind::Fabric,
                    loader_version: None,
                    icon: None,
                    group: None,
                    tags: vec![TAG.into()],
                    install_loader: true,
                },
            )
            .await?;
            let icon = state.paths.instance_dir(&created.id).join("icon.png");
            if std::fs::write(&icon, ICON).is_ok() {
                let mut store = state.instances.write().await;
                store.get_mut(&created.id)?.icon = Some(icon.to_string_lossy().to_string());
                store.persist(&state.paths, &created.id)?;
            }
            created.id
        }
    };

    repair(&app, &state, &id).await?;
    update_jar(&app, &state, &id).await?;
    Ok(state.instances.read().await.get(&id)?.clone())
}

/// A missing loader version would launch vanilla, and Orbit Client needs Fabric API: put back
/// whatever an interrupted install left out. Does nothing (and needs no network) when both are there.
async fn repair(app: &AppHandle, state: &State<'_, AppState>, id: &str) -> Result<()> {
    let instance = state.instances.read().await.get(id)?.clone();
    if instance.loader_version.is_none() {
        instance_install_loader(app.clone(), state.clone(), id.to_string(), None, None).await?;
    }
    ensure_fabric_api(app, state, &instance).await
}

/// Install Fabric API unless the instance has it, tracked or as a loose jar (modpacks bring their own).
async fn ensure_fabric_api(app: &AppHandle, state: &State<'_, AppState>, instance: &Instance) -> Result<()> {
    let tracked = instance.installed_projects.iter().any(|p| p.project_id == FABRIC_API);
    if !tracked && !has_mod_jar(&game_dir(&state.paths, instance).join("mods"), "fabric-api") {
        modrinth_install(app.clone(), state.clone(), instance.id.clone(), FABRIC_API.into(), None).await?;
    }
    Ok(())
}

/// Whether Orbit Client's jar for this game version depends on Fabric API: the full client does
/// (Minecraft 1.15 and newer), the cosmetics-only builds for 1.14 and older don't.
pub fn needs_fabric_api(game_version: &str) -> bool {
    let numbers: Vec<u64> = game_version
        .split(['.', '-'])
        .map_while(|part| part.chars().take_while(char::is_ascii_digit).collect::<String>().parse().ok())
        .collect();
    !matches!(numbers.as_slice(), [1, minor, ..] if *minor < 15)
}

/// Whether `mods` holds a jar whose name starts with `prefix`, enabled or disabled.
fn has_mod_jar(mods: &std::path::Path, prefix: &str) -> bool {
    std::fs::read_dir(mods).is_ok_and(|entries| {
        entries.flatten().any(|e| {
            let name = e.file_name().to_string_lossy().to_ascii_lowercase();
            name.starts_with(prefix) && (name.ends_with(".jar") || name.ends_with(".jar.disabled"))
        })
    })
}

/// Before any other instance launches: give it Orbit Client when it's a Fabric instance on a
/// version Orbit Client has a jar for, the setting is on and the player didn't remove it there.
/// Never stops the launch: offline or on an unsupported version it plays as it is.
pub async fn prepare_other_launch(app: &AppHandle, state: &State<'_, AppState>, id: &str) {
    if !state.settings.read().await.orbit_in_every_instance {
        return;
    }
    let Ok(instance) = state.instances.read().await.get(id).cloned() else { return };
    if instance.loader != LoaderKind::Fabric || instance.tags.iter().any(|t| t == OPT_OUT_TAG) {
        return;
    }
    // A jar the player disabled stays disabled.
    let mods = game_dir(&state.paths, &instance).join("mods");
    if std::fs::read_dir(&mods).is_ok_and(|entries| {
        entries.flatten().any(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.starts_with("orbit-client-") && name.ends_with(".jar.disabled")
        })
    }) {
        return;
    }
    let result = async {
        let release = latest_release(state).await?;
        if pick_asset(&release, &instance.game_version).is_none() {
            return Ok(());
        }
        // Fabric API first: Orbit Client without it would crash the game. (Its builds for 1.14 and
        // older are the cosmetics-only client, which doesn't use Fabric API; there is none for
        // Legacy Fabric versions anyway.)
        if needs_fabric_api(&instance.game_version) {
            ensure_fabric_api(app, state, &instance).await?;
        }
        update_jar_from(app, state, id, &release).await.map(|_| ())
    }
    .await;
    if let Err(error) = result {
        log::warn!("orbit client: not added to instance {id}: {error}");
    }
}

async fn latest_release(state: &AppState) -> Result<Release> {
    get_json(&state.http, LATEST_RELEASE).await
}

/// Before a launch: repair the instance, then the newest jar if GitHub can be reached, else the one already there.
pub async fn prepare_launch(app: &AppHandle, state: &State<'_, AppState>, id: &str) -> Result<()> {
    repair(app, state, id).await?;
    if let Err(error) = update_jar(app, state, id).await {
        let instance = state.instances.read().await.get(id)?.clone();
        if installed_version(&instance).is_none() {
            return Err(error);
        }
        log::warn!("orbit client: keeping the installed jar, update check failed: {error}");
    }
    Ok(())
}

/// What an automatic update did.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbitUpdates {
    /// The newest release's tag, e.g. `v1.1.4`.
    pub version: String,
    /// The names of the instances whose jar was replaced with that release's.
    pub updated: Vec<String>,
    /// How many instances were due an update that failed (they update at their next launch).
    pub failed: usize,
}

/// Whether an instance should get `release`'s jar without being asked: it has Orbit Client from an
/// older release, the jar is still there and enabled (one the player removed or disabled is left
/// alone), and the release has a jar for its Minecraft version.
fn due_for_update(instance: &Instance, mods: &std::path::Path, release: &Release) -> bool {
    let Some(current) = installed_version(instance) else { return false };
    current.version_id != release.tag_name
        && current.files.iter().any(|file| is_safe_filename(file) && mods.join(file).is_file())
        && pick_asset(release, &instance.game_version).is_some()
}

/// Look for a new Orbit Client release and give it to every instance that has the mod, so the
/// update is already there at the next launch. Called by the launcher while it is open. A running
/// instance is skipped: the game holds its jars open, and it updates when it next starts.
/// Fails only when GitHub can't be asked; needs no network when no instance has the mod.
#[tauri::command]
pub async fn orbit_client_update_all(app: AppHandle, state: State<'_, AppState>) -> Result<Option<OrbitUpdates>> {
    let tracked: Vec<Instance> =
        state.instances.read().await.instances.iter().filter(|i| installed_version(i).is_some()).cloned().collect();
    if tracked.is_empty() {
        return Ok(None);
    }
    let release = latest_release(&state).await?;
    let mut updates = OrbitUpdates { version: release.tag_name.clone(), updated: Vec::new(), failed: 0 };
    for instance in tracked {
        let mods = game_dir(&state.paths, &instance).join("mods");
        if !due_for_update(&instance, &mods, &release) || state.is_running(&instance.id).await {
            continue;
        }
        match update_jar_from(&app, &state, &instance.id, &release).await {
            Ok(Some(_)) => updates.updated.push(instance.name.clone()),
            Ok(None) => {}
            Err(error) => {
                updates.failed += 1;
                log::warn!("orbit client: automatic update of instance {} failed: {error}", instance.id);
            }
        }
    }
    Ok(Some(updates))
}

/// One update at a time: a launch and the automatic check may reach the same instance together.
static UPDATING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Download the newest Orbit Client jar if it isn't the one installed. Returns
/// the new version, or `None` when it was already current.
pub async fn update_jar(app: &AppHandle, state: &AppState, id: &str) -> Result<Option<String>> {
    let release = latest_release(state).await?;
    update_jar_from(app, state, id, &release).await
}

async fn update_jar_from(app: &AppHandle, state: &AppState, id: &str, release: &Release) -> Result<Option<String>> {
    let _one_at_a_time = UPDATING.lock().await;
    let instance = state.instances.read().await.get(id)?.clone();
    let asset = pick_asset(release, &instance.game_version).ok_or_else(|| {
        LauncherError::msg(format!("The latest Orbit Client release has no jar for Minecraft {}.", instance.game_version))
    })?;
    if !is_safe_filename(&asset.name) {
        return Err(LauncherError::msg("The Orbit Client release has an unsafe file name."));
    }

    let root = game_dir(&state.paths, &instance);
    let mods = root.join("mods");
    std::fs::create_dir_all(&mods)?;
    let dest = mods.join(&asset.name);
    if !destination_is_within(&root, &dest) {
        return Err(LauncherError::msg("The mods folder resolves outside this instance."));
    }
    let current = installed_version(&instance);
    if dest.is_file() && current.is_some_and(|p| p.version_id == release.tag_name) {
        return Ok(None);
    }

    // A leftover file of the same name (an interrupted update) would be taken as done.
    let _ = std::fs::remove_file(&dest);
    let spec = DownloadSpec::new(asset.browser_download_url.clone(), &dest)
        .with_size(asset.size)
        .with_label("Orbit Client");
    download_many(state.http.clone(), vec![spec], 1, "install", state.sink(app)).await?;
    if let Some(expected) = asset.digest.as_deref().and_then(|d| d.strip_prefix("sha256:")) {
        let actual = format!("{:x}", Sha256::digest(std::fs::read(&dest)?));
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_file(&dest);
            return Err(LauncherError::msg("The Orbit Client download was corrupted. Try again."));
        }
    }

    // Older jars go, so only one Orbit Client is ever loaded.
    for entry in std::fs::read_dir(&mods)?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name != asset.name && name.starts_with("orbit-client-") && name.ends_with(".jar") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    {
        let mut store = state.instances.write().await;
        let entry = store.get_mut(id)?;
        entry.installed_projects.retain(|p| p.project_id != PROJECT_ID);
        entry.installed_projects.push(InstalledProject {
            project_id: PROJECT_ID.into(),
            version_id: release.tag_name.clone(),
            title: "Orbit Client".into(),
            icon_url: None,
            project_type: "mod".into(),
            files: vec![asset.name.clone()],
            installed_at: Some(chrono::Utc::now().to_rfc3339()),
        });
        store.persist(&state.paths, id)?;
    }
    log::info!("orbit client: installed {} ({})", release.tag_name, asset.name);
    Ok(Some(release.tag_name.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> Asset {
        Asset { name: name.into(), browser_download_url: format!("https://example.invalid/{name}"), size: 1, digest: None }
    }

    fn instance_with(version: &str, file: &str) -> Instance {
        let mut instance = Instance::new("test", "26.3".to_string(), LoaderKind::Fabric);
        instance.installed_projects.push(InstalledProject {
            project_id: PROJECT_ID.into(),
            version_id: version.into(),
            title: "Orbit Client".into(),
            icon_url: None,
            project_type: "mod".into(),
            files: vec![file.into()],
            installed_at: None,
        });
        instance
    }

    /// The automatic update only replaces a jar that is there and enabled, from an older release.
    #[test]
    fn automatic_update_only_where_the_mod_is_installed_and_older() {
        let mods = std::env::temp_dir().join(format!("orbit-auto-update-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&mods);
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("orbit-client-1.1.3+26.3.jar"), b"jar").unwrap();
        let release = Release { tag_name: "v1.1.4".into(), assets: vec![asset("orbit-client-1.1.4+26.3.jar"), asset("orbit-client-1.1.4+1.21.11.jar")] };

        let older = instance_with("v1.1.3", "orbit-client-1.1.3+26.3.jar");
        assert!(due_for_update(&older, &mods, &release), "an older jar that is there is updated");
        assert!(!due_for_update(&instance_with("v1.1.4", "orbit-client-1.1.3+26.3.jar"), &mods, &release), "already on this release");
        assert!(!due_for_update(&instance_with("v1.1.3", "orbit-client-1.1.2+26.3.jar"), &mods, &release), "the jar was deleted");
        assert!(!due_for_update(&Instance::new("test", "26.3".to_string(), LoaderKind::Fabric), &mods, &release), "never had the mod");

        // Disabled by the player: the tracked file is gone, a .disabled one is there.
        std::fs::rename(mods.join("orbit-client-1.1.3+26.3.jar"), mods.join("orbit-client-1.1.3+26.3.jar.disabled")).unwrap();
        assert!(!due_for_update(&older, &mods, &release), "a disabled jar stays as it is");

        // No jar for this Minecraft version in the new release.
        std::fs::write(mods.join("orbit-client-1.1.3+1.19.jar"), b"jar").unwrap();
        let mut other = instance_with("v1.1.3", "orbit-client-1.1.3+1.19.jar");
        other.game_version = "1.19".into();
        assert!(!due_for_update(&other, &mods, &release), "the release has nothing for 1.19");
        let _ = std::fs::remove_dir_all(&mods);
    }

    /// Releases carry the mod jar and possibly its sources jar; only the mod jar may be installed.
    #[test]
    fn picks_the_mod_jar_not_the_sources() {
        let release = Release {
            tag_name: "v1.2.0".into(),
            assets: vec![asset("orbit-client-1.2.0-sources.jar"), asset("notes.txt"), asset("orbit-client-1.2.0.jar")],
        };
        assert_eq!(pick_asset(&release, GAME_VERSION).map(|a| a.name.as_str()), Some("orbit-client-1.2.0.jar"));
        assert!(pick_asset(&Release { tag_name: "v0".into(), assets: vec![asset("readme.md")] }, GAME_VERSION).is_none());
    }

    /// Multi-version releases carry a jar per Minecraft version; an instance gets the one for its version.
    #[test]
    fn picks_the_jar_for_the_instance_version() {
        let release = Release {
            tag_name: "v1.1.0".into(),
            assets: vec![asset("orbit-client-1.1.0+26.3.jar"), asset("orbit-client-1.1.0+1.21.11.jar"), asset("orbit-client-1.1.0+1.21.11-sources.jar")],
        };
        assert_eq!(pick_asset(&release, "1.21.11").map(|a| a.name.as_str()), Some("orbit-client-1.1.0+1.21.11.jar"));
        assert_eq!(pick_asset(&release, "26.3").map(|a| a.name.as_str()), Some("orbit-client-1.1.0+26.3.jar"));
        assert!(pick_asset(&release, "1.20.1").is_none(), "no jar for an unsupported version");
    }

    /// The tag marks the managed instance; other instances are left alone.
    #[test]
    fn only_tagged_instances_are_orbit() {
        let mut instance = Instance::new("Orbit Client", GAME_VERSION, LoaderKind::Fabric);
        assert!(!is_orbit(&instance));
        instance.tags.push(TAG.into());
        assert!(is_orbit(&instance));
    }

    /// The live latest release parses and offers a jar with a checksum (`cargo test -- --ignored`).
    #[tokio::test]
    #[ignore = "needs the network"]
    async fn the_live_release_has_a_jar() {
        let http = reqwest::Client::new();
        let release: Release = get_json(&http, LATEST_RELEASE).await.expect("latest release");
        let jar = pick_asset(&release, GAME_VERSION).expect("a mod jar");
        assert!(jar.digest.as_deref().is_some_and(|d| d.starts_with("sha256:")), "{jar:?}");
    }

    /// Fabric API's Modrinth id is hard-coded; a wrong one makes every Orbit Client install fail (v0.4.0 shipped one).
    #[tokio::test]
    #[ignore = "needs the network"]
    async fn the_fabric_api_id_is_real() {
        #[derive(Deserialize)]
        struct Project {
            slug: String,
        }
        let http = reqwest::Client::builder().user_agent(crate::USER_AGENT).build().unwrap();
        let url = format!("https://api.modrinth.com/v2/project/{FABRIC_API}");
        let project: Project = get_json(&http, &url).await.expect("Fabric API on Modrinth");
        assert_eq!(project.slug, "fabric-api");
    }

    /// Modpacks ship Fabric API as a loose jar; finding it there avoids installing a second copy.
    #[test]
    fn finds_loose_mod_jars() {
        let dir = std::env::temp_dir().join(format!("orbit-mods-{}", crate::core::instance::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!has_mod_jar(&dir, "fabric-api"));
        std::fs::write(dir.join("fabric-api-0.141.6+1.21.11.jar"), b"").unwrap();
        assert!(has_mod_jar(&dir, "fabric-api"));
        assert!(!has_mod_jar(&dir, "sodium"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The record's id must survive the store's cleanup of malformed project ids.
    #[test]
    fn the_jar_record_survives_project_id_cleanup() {
        assert!(PROJECT_ID.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
    }
}

#[cfg(test)]
mod fabric_api_tests {
    use super::needs_fabric_api;

    #[test]
    fn only_the_full_client_needs_fabric_api() {
        for game in ["1.8.9", "1.12.2", "1.13.2", "1.14", "1.14.4"] {
            assert!(!needs_fabric_api(game), "{game}");
        }
        for game in ["1.15", "1.16.5", "1.21.11", "26.1", "26.3"] {
            assert!(needs_fabric_api(game), "{game}");
        }
    }
}
