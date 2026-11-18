//! FPS boost: a fixed list of well-known free mods that make Minecraft itself run faster, for every
//! loader and Minecraft version they're published for.
//!
//! With "Automatic FPS boost" on (Settings > General, the default) an instance gets them when it starts
//! (`prepare_launch`); the Content tab's "Performance mods" button adds them on request either way. Only a
//! version Modrinth lists for the instance's exact game version and loader is ever picked, so an old version
//! simply gets fewer mods, or none. A mod the instance already has, enabled or disabled, is left alone; one
//! the player deletes after it was added automatically is never added again; and nothing is added next to a
//! mod it's known to clash with (OptiFine, VulkanMod, another renderer).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::api::modrinth::ModrinthClient;
use crate::commands::modrinth::{modrinth_install, modrinth_install_limited};
use crate::core::instance::{game_dir, Instance, LoaderKind};
use crate::error::Result;
use crate::state::AppState;

use LoaderKind::{Fabric, Forge, NeoForge, Quilt};

/// One mod on the list: its Modrinth project, what to call it, what it does in a few words, how its jar's
/// file name starts (lower case, to recognise a copy added by hand), the loaders it's offered on, and the
/// jars it must never be added next to.
struct Known {
    project_id: &'static str,
    title: &'static str,
    summary: &'static str,
    file_prefix: &'static str,
    loaders: &'static [LoaderKind],
    clashes: &'static [&'static str],
}

/// Renderers that replace Minecraft's own the way Sodium and Embeddium do; only one of them can load.
const RENDERERS: &[&str] = &["optifine", "optifabric", "vulkanmod", "canvas-", "sodium-", "embeddium-", "rubidium-", "magnesium-", "nvidium-"];

/// In order: a mod earlier in the list wins over a later one that does the same job (Sodium over Embeddium).
const KNOWN: &[Known] = &[
    Known { project_id: "AANobbMI", title: "Sodium", summary: "Much faster world rendering", file_prefix: "sodium-", loaders: &[Fabric, Quilt, NeoForge], clashes: RENDERERS },
    Known { project_id: "sk9rgfiA", title: "Embeddium", summary: "Sodium's rendering for Forge", file_prefix: "embeddium-", loaders: &[Forge, NeoForge], clashes: RENDERERS },
    Known { project_id: "gvQqBUqZ", title: "Lithium", summary: "Faster game logic and ticking", file_prefix: "lithium-", loaders: &[Fabric, Quilt, NeoForge], clashes: &["canary-", "radium-", "roadrunner-"] },
    Known { project_id: "uXXizFIs", title: "FerriteCore", summary: "Much lower memory use", file_prefix: "ferritecore-", loaders: &[Fabric, Quilt, Forge, NeoForge], clashes: &[] },
    Known { project_id: "nmDcB62a", title: "ModernFix", summary: "Faster start-up and less memory", file_prefix: "modernfix-", loaders: &[Fabric, Forge, NeoForge], clashes: &[] },
    Known { project_id: "NNAgCjsB", title: "Entity Culling", summary: "Skips entities hidden behind walls", file_prefix: "entityculling-", loaders: &[Fabric, Quilt, Forge, NeoForge], clashes: &[] },
    Known { project_id: "51shyZVL", title: "More Culling", summary: "Skips hidden block faces", file_prefix: "moreculling-", loaders: &[Fabric, Quilt, NeoForge], clashes: &["optifine", "optifabric"] },
    Known { project_id: "5ZwdcRci", title: "ImmediatelyFast", summary: "Faster HUD, text and entity drawing", file_prefix: "immediatelyfast-", loaders: &[Fabric, Quilt, Forge, NeoForge], clashes: &[] },
    Known { project_id: "LQ3K71Q1", title: "Dynamic FPS", summary: "Saves power while the game is in the background", file_prefix: "dynamic-fps-", loaders: &[Fabric, Quilt, Forge, NeoForge], clashes: &[] },
];

/// Other mods whose jars start the same way as one on the list.
const NOT_THESE: &[&str] = &["sodium-extra", "sodium-shadowy", "sodium-dynamic"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PerformanceState {
    /// The instance already has it (enabled or disabled).
    Installed,
    /// Modrinth has a version for this game version and loader.
    Available,
    /// Modrinth has none for this game version and loader, or it would clash with a mod already there
    /// (`detail` says which).
    Unavailable,
    /// Installed by this call.
    Added,
    /// Installing it failed; `detail` says why.
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMod {
    pub project_id: String,
    pub title: String,
    pub summary: String,
    pub state: PerformanceState,
    /// The version that would be (or was) installed.
    pub version_id: Option<String>,
    pub version_name: Option<String>,
    pub detail: Option<String>,
}

/// Every loader that can run mods gets FPS mods; vanilla can't load any.
pub fn supports(loader: LoaderKind) -> bool {
    matches!(loader, Fabric | Quilt | Forge | NeoForge)
}

/// The Modrinth loaders whose builds an instance can run: Quilt also loads Fabric mods.
fn modrinth_loaders(loader: LoaderKind) -> Vec<String> {
    match loader {
        Quilt => vec!["quilt".into(), "fabric".into()],
        other => vec![other.modrinth_name().into()],
    }
}

fn file_matches(prefix: &str, file_name: &str) -> bool {
    let name = file_name.to_ascii_lowercase();
    (name.ends_with(".jar") || name.ends_with(".jar.disabled")) && name.starts_with(prefix)
}

/// Whether a file in `mods` is this mod's jar, enabled or disabled.
fn is_jar_of(known: &Known, file_name: &str) -> bool {
    file_matches(known.file_prefix, file_name) && !NOT_THESE.iter().any(|other| file_name.to_ascii_lowercase().starts_with(other))
}

fn has(known: &Known, instance: &Instance, mod_files: &[String]) -> bool {
    instance.installed_projects.iter().any(|p| p.project_id == known.project_id)
        || mod_files.iter().any(|file| is_jar_of(known, file))
}

/// The jar already in the instance that `known` mustn't be added next to (not counting its own).
fn clash<'a>(known: &Known, mod_files: &'a [String]) -> Option<&'a String> {
    mod_files.iter().find(|file| !is_jar_of(known, file) && known.clashes.iter().any(|prefix| file_matches(prefix, file)))
}

fn mod_files(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default()
}

/// What the instance has and what Modrinth offers it. Fails only when Modrinth can't be reached:
/// an unknown answer is never shown as "not available".
async fn survey(state: &AppState, instance: &Instance) -> Result<Vec<PerformanceMod>> {
    let mut mod_files = mod_files(&game_dir(&state.paths, instance).join("mods"));
    let client = ModrinthClient::new(state.http.clone(), state.modrinth_base().await);
    let game_versions = vec![instance.game_version.clone()];
    let loaders = modrinth_loaders(instance.loader);

    let mut list = Vec::new();
    for known in KNOWN.iter().filter(|k| k.loaders.contains(&instance.loader)) {
        let mut entry = PerformanceMod {
            project_id: known.project_id.into(),
            title: known.title.into(),
            summary: known.summary.into(),
            state: PerformanceState::Installed,
            version_id: None,
            version_name: None,
            detail: None,
        };
        if !has(known, instance, &mod_files) {
            if let Some(other) = clash(known, &mod_files) {
                entry.state = PerformanceState::Unavailable;
                entry.detail = Some(format!("Not added next to {other}"));
            } else {
                // Strictly this game version and these loaders: the general installer falls back to
                // the newest version of anything, which would be the wrong build here.
                let versions = client.versions(known.project_id, &game_versions, &loaders).await?;
                match newest_stable(versions) {
                    Some(version) => {
                        entry.state = PerformanceState::Available;
                        // Counts as there for the mods after it: Sodium coming keeps Embeddium out.
                        mod_files.push(format!("{}planned.jar", known.file_prefix));
                        entry.version_id = Some(version.id);
                        entry.version_name = Some(version.version_number);
                    }
                    None => entry.state = PerformanceState::Unavailable,
                }
            }
        }
        list.push(entry);
    }
    Ok(list)
}

/// The version to install from Modrinth's list (newest first): the newest release, or the
/// newest of any kind when the mod has only betas or alphas for this game version.
fn newest_stable(versions: Vec<crate::api::modrinth::Version>) -> Option<crate::api::modrinth::Version> {
    let stable = versions.iter().position(|v| v.version_type == "release").unwrap_or(0);
    versions.into_iter().nth(stable)
}

/// The only extra mods an automatic install may bring along: libraries the FPS mods need (Fabric API, Cloth Config).
const AUTO_DEPENDENCIES: &[&str] = &["P7dR8mSH", "9s6osm5g"];

/// Install every mod in `list` marked available. One failing doesn't stop the others. `automatic` installs (at launch,
/// nobody asked) only take the dependencies in `AUTO_DEPENDENCIES`.
async fn install_available(app: &AppHandle, state: &State<'_, AppState>, instance_id: &str, list: &mut [PerformanceMod], automatic: bool) {
    for entry in list.iter_mut().filter(|e| e.state == PerformanceState::Available) {
        // A mod installed a moment ago may have brought this one along as a dependency.
        let already = state
            .instances
            .read()
            .await
            .get(instance_id)
            .is_ok_and(|i| i.installed_projects.iter().any(|p| p.project_id == entry.project_id));
        if already {
            entry.state = PerformanceState::Added;
            continue;
        }
        let result = if automatic {
            modrinth_install_limited(app.clone(), state.clone(), instance_id.to_string(), entry.project_id.clone(), entry.version_id.clone(), AUTO_DEPENDENCIES).await
        } else {
            modrinth_install(app.clone(), state.clone(), instance_id.to_string(), entry.project_id.clone(), entry.version_id.clone()).await
        };
        match result {
            Ok(_) => entry.state = PerformanceState::Added,
            Err(error) => {
                entry.state = PerformanceState::Failed;
                entry.detail = Some(error.to_string());
            }
        }
    }
}

/// Which performance mods an instance has, can get, or can't.
#[tauri::command]
pub async fn performance_mods_status(state: State<'_, AppState>, instance_id: String) -> Result<Vec<PerformanceMod>> {
    let instance = state.instances.read().await.get(&instance_id)?.clone();
    if !supports(instance.loader) {
        return Ok(vec![]);
    }
    survey(&state, &instance).await
}

/// Install every performance mod the instance can get and doesn't have. Returns the same list
/// as the status, with each mod's outcome.
#[tauri::command]
pub async fn performance_mods_install(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<Vec<PerformanceMod>> {
    let instance = state.instances.read().await.get(&instance_id)?.clone();
    if !supports(instance.loader) {
        return Ok(vec![]);
    }
    let mut list = survey(&state, &instance).await?;
    install_available(&app, &state, &instance_id, &mut list, false).await;
    Ok(list)
}

// ---------- Automatic, at launch ----------

/// What the automatic boost remembers per instance (`<instance>/fps-boost.json`): when it last asked
/// Modrinth for which game version and loader, and every mod it added itself.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoRecord {
    #[serde(default)]
    checked_at: i64,
    #[serde(default)]
    checked_for: String,
    #[serde(default)]
    added: Vec<String>,
}

/// Ask Modrinth again at most this often for the same game version and loader.
const RECHECK_SECS: i64 = 24 * 60 * 60;

fn record_path(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("fps-boost.json")
}

/// Whether this instance should get FPS mods without being asked. A modpack keeps the mods its author
/// chose (the button still offers them).
fn auto_applies(instance: &Instance) -> bool {
    supports(instance.loader)
        && !instance.installed_projects.iter().any(|p| p.project_type == "modpack")
        // A game folder of its own may be shared with another launcher: nothing is added there unasked.
        && instance.settings.game_dir.is_none()
}

/// Whether the instance has a renderer (Sodium, Embeddium, OptiFine…) that the launcher didn't add itself.
fn already_tuned(mod_files: &[String], added_by_launcher: &[String]) -> bool {
    mod_files.iter().any(|file| {
        RENDERERS.iter().any(|prefix| file_matches(prefix, file))
            && !KNOWN.iter().any(|k| added_by_launcher.iter().any(|id| id == k.project_id) && is_jar_of(k, file))
    })
}

/// Before an instance starts, with the setting on: add the FPS mods it doesn't have yet. Never stops the
/// launch; offline, or on a version with none, it plays as it is.
pub async fn prepare_launch(app: &AppHandle, state: &State<'_, AppState>, id: &str) {
    if !state.settings.read().await.auto_fps {
        return;
    }
    let Ok(instance) = state.instances.read().await.get(id).cloned() else { return };
    if !auto_applies(&instance) {
        return;
    }
    let path = record_path(state, id);
    let mut record: AutoRecord = std::fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    let target = format!("{}|{}", instance.game_version, instance.loader.modrinth_name());
    let now = chrono::Utc::now().timestamp();
    if record.checked_for == target && now.saturating_sub(record.checked_at) < RECHECK_SECS {
        return;
    }
    // Already tuned by the player or a modpack (one imported from another launcher isn't marked as a pack):
    // a renderer the launcher didn't add means someone chose this instance's performance mods. Leave them be.
    let files = mod_files(&game_dir(&state.paths, &instance).join("mods"));
    if already_tuned(&files, &record.added) {
        log::info!("fps boost: instance {id} already has its own performance setup, leaving it as it is");
        record.checked_at = now;
        record.checked_for = target;
        if let Ok(bytes) = serde_json::to_vec_pretty(&record) {
            let _ = std::fs::write(&path, bytes);
        }
        return;
    }
    let mut list = match survey(state, &instance).await {
        Ok(list) => list,
        Err(error) => {
            log::warn!("fps boost: couldn't check instance {id}: {error}");
            return;
        }
    };
    // One it added before that isn't there any more was deleted by the player: that one stays out.
    for entry in list.iter_mut() {
        if entry.state == PerformanceState::Available && record.added.contains(&entry.project_id) {
            entry.state = PerformanceState::Unavailable;
        }
    }
    install_available(app, state, id, &mut list, true).await;
    for entry in &list {
        match entry.state {
            PerformanceState::Added if !record.added.contains(&entry.project_id) => record.added.push(entry.project_id.clone()),
            PerformanceState::Failed => log::warn!("fps boost: {} not added to {id}: {}", entry.title, entry.detail.as_deref().unwrap_or("")),
            _ => {}
        }
    }
    // A failed install is tried again at the next launch rather than tomorrow.
    if !list.iter().any(|e| e.state == PerformanceState::Failed) {
        record.checked_at = now;
        record.checked_for = target;
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(&record) {
        let _ = std::fs::write(&path, bytes);
    }
    let added: Vec<&str> = list.iter().filter(|e| e.state == PerformanceState::Added).map(|e| e.title.as_str()).collect();
    if !added.is_empty() {
        log::info!("fps boost: added {} to instance {id}", added.join(", "));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(title: &str) -> &'static Known {
        KNOWN.iter().find(|k| k.title == title).unwrap()
    }

    #[test]
    fn recognises_jars_added_by_hand() {
        assert!(is_jar_of(known("Sodium"), "sodium-fabric-0.9.2+mc26.2.jar"));
        assert!(is_jar_of(known("Sodium"), "sodium-fabric-0.5.8+mc1.20.1.jar.disabled"));
        assert!(is_jar_of(known("Lithium"), "lithium-fabric-0.25.3+mc26.2.jar"));
        assert!(is_jar_of(known("FerriteCore"), "ferritecore-9.0.0-fabric.jar"));
        assert!(is_jar_of(known("Entity Culling"), "entityculling-fabric-1.11.3-mc26.2.jar"));
        assert!(is_jar_of(known("ImmediatelyFast"), "ImmediatelyFast-Fabric-1.16.5+26.2.jar"));
        assert!(is_jar_of(known("Embeddium"), "embeddium-0.3.31+mc1.20.1.jar"));
        assert!(is_jar_of(known("ModernFix"), "modernfix-forge-5.19.4+mc1.20.1.jar"));
        assert!(is_jar_of(known("Dynamic FPS"), "dynamic-fps-3.9.0+minecraft-1.21.0-fabric.jar"));
    }

    #[test]
    fn lookalikes_are_not_the_mod() {
        assert!(!is_jar_of(known("Sodium"), "sodium-extra-fabric-0.9.5+mc26.2.jar"));
        assert!(!is_jar_of(known("Sodium"), "sodium-shadowy-path-blocks-fabric-7.0.0.jar"));
        assert!(!is_jar_of(known("Sodium"), "reeses-sodium-options-fabric-2.2.4.jar"));
        assert!(!is_jar_of(known("Lithium"), "lithium-fabric-0.25.3.jar.txt"));
        assert!(!is_jar_of(known("Sodium"), "sodium-fabric-0.9.2.zip"));
    }

    #[test]
    fn every_modding_loader_is_offered() {
        assert!(supports(Fabric) && supports(Quilt) && supports(Forge) && supports(NeoForge));
        assert!(!supports(LoaderKind::Vanilla));
        // Each loader gets a renderer, a memory saver and culling.
        for loader in [Fabric, Quilt, Forge, NeoForge] {
            let titles: Vec<&str> = KNOWN.iter().filter(|k| k.loaders.contains(&loader)).map(|k| k.title).collect();
            assert!(titles.contains(&"Sodium") || titles.contains(&"Embeddium"), "{loader:?}");
            assert!(titles.contains(&"FerriteCore") && titles.contains(&"Entity Culling"), "{loader:?}");
        }
    }

    #[test]
    fn quilt_also_takes_fabric_builds() {
        assert_eq!(modrinth_loaders(Quilt), vec!["quilt", "fabric"]);
        assert_eq!(modrinth_loaders(Forge), vec!["forge"]);
    }

    #[test]
    fn a_renderer_is_never_added_next_to_another() {
        let files = vec!["OptiFine_1.20.1_HD_U_I6.jar".to_string(), "jei-1.20.1.jar".to_string()];
        assert!(clash(known("Sodium"), &files).is_some());
        assert!(clash(known("Embeddium"), &files).is_some());
        assert!(clash(known("FerriteCore"), &files).is_none());
        // Sodium there (or about to be added) keeps Embeddium out, and the reverse.
        assert!(clash(known("Embeddium"), &["sodium-neoforge-0.6.0.jar".to_string()]).is_some());
        assert!(clash(known("Sodium"), &["embeddium-1.0.11+mc1.21.1.jar".to_string()]).is_some());
        // A mod is never its own clash.
        assert!(clash(known("Sodium"), &["sodium-fabric-0.6.0.jar".to_string()]).is_none());
        assert!(clash(known("Sodium"), &["vulkanmod_1.21-0.5.jar".to_string()]).is_some());
    }

    #[test]
    fn a_pack_with_its_own_renderer_is_left_alone() {
        let pack = vec!["sodium-fabric-0.5.11+mc1.19.2.jar".to_string(), "iris-1.6.jar".to_string()];
        assert!(already_tuned(&pack, &[]));
        assert!(already_tuned(&["OptiFine_1.20.1_HD_U_I6.jar".to_string()], &[]));
        // Sodium the launcher added itself doesn't count: the instance keeps getting the rest of the set.
        assert!(!already_tuned(&pack, &["AANobbMI".to_string()]));
        assert!(!already_tuned(&["jei-1.20.1.jar".to_string()], &[]));
    }

    fn instance(loader: LoaderKind) -> Instance {
        Instance::new("Test", "1.21.1", loader)
    }

    #[test]
    fn modpacks_are_left_as_their_author_made_them() {
        assert!(auto_applies(&instance(Fabric)));
        assert!(!auto_applies(&instance(LoaderKind::Vanilla)));
        let mut pack = instance(Forge);
        pack.installed_projects.push(serde_json::from_value(serde_json::json!({
            "projectId": "p", "versionId": "v", "title": "Pack", "projectType": "modpack"
        })).unwrap());
        assert!(!auto_applies(&pack));
        let mut shared = instance(Fabric);
        shared.settings.game_dir = Some("C:/Users/me/AppData/Roaming/.minecraft".into());
        assert!(!auto_applies(&shared));
    }

    fn version(id: &str, kind: &str) -> crate::api::modrinth::Version {
        serde_json::from_value(serde_json::json!({"id": id, "project_id": "p", "name": id, "version_type": kind})).unwrap()
    }

    #[test]
    fn a_release_is_preferred_over_a_newer_beta() {
        let picked = newest_stable(vec![version("beta-2", "beta"), version("release-1", "release"), version("release-0", "release")]);
        assert_eq!(picked.unwrap().id, "release-1");
        // Only betas for this game version: the newest of them.
        let picked = newest_stable(vec![version("beta-2", "beta"), version("alpha-1", "alpha")]);
        assert_eq!(picked.unwrap().id, "beta-2");
        assert!(newest_stable(vec![]).is_none());
    }

    #[test]
    fn the_list_has_no_duplicates() {
        for (i, a) in KNOWN.iter().enumerate() {
            for b in &KNOWN[i + 1..] {
                assert_ne!(a.project_id, b.project_id);
                assert_ne!(a.file_prefix, b.file_prefix);
            }
        }
    }

    /// Every id on the list is a real Modrinth mod with the title used here.
    #[tokio::test]
    #[ignore = "needs the network"]
    async fn the_ids_are_real() {
        let http = reqwest::Client::builder().user_agent("orbit-launcher-test").build().unwrap();
        let client = ModrinthClient::new(http, "https://api.modrinth.com/v2".to_string());
        for known in KNOWN {
            let project = client.project(known.project_id).await.expect(known.title);
            assert_eq!(project.title, known.title);
            assert_eq!(project.project_type, "mod");
        }
    }
}
