//! Performance mods: a short, fixed list of well-known free mods that make Minecraft itself
//! run faster, offered per instance from its Content tab.
//!
//! The launcher can't make the game faster by itself; these mods can. Nothing is installed
//! without the player asking, only a version Modrinth lists for the instance's exact game
//! version and loader is ever picked (so an old version simply gets fewer mods, or none), and a
//! mod the instance already has, enabled or disabled, is left alone.

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::api::modrinth::ModrinthClient;
use crate::commands::modrinth::modrinth_install;
use crate::core::instance::{game_dir, Instance, LoaderKind};
use crate::error::Result;
use crate::state::AppState;

/// One mod on the list: its Modrinth project, what to call it, what it does in a few words,
/// and how its jar's file name starts (lower case), to recognise a copy added by hand.
struct Known {
    project_id: &'static str,
    title: &'static str,
    summary: &'static str,
    file_prefix: &'static str,
}

const KNOWN: &[Known] = &[
    Known { project_id: "AANobbMI", title: "Sodium", summary: "Faster world rendering", file_prefix: "sodium-" },
    Known { project_id: "gvQqBUqZ", title: "Lithium", summary: "Faster game logic", file_prefix: "lithium-" },
    Known { project_id: "uXXizFIs", title: "FerriteCore", summary: "Lower memory use", file_prefix: "ferritecore-" },
    Known { project_id: "NNAgCjsB", title: "Entity Culling", summary: "Skips entities hidden behind walls", file_prefix: "entityculling-" },
    Known { project_id: "5ZwdcRci", title: "ImmediatelyFast", summary: "Faster HUD, text and entity drawing", file_prefix: "immediatelyfast-" },
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
    /// Modrinth has none for this game version and loader.
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

/// The mods on the list are published for Fabric and Quilt throughout; other loaders aren't offered them here.
pub fn supports(loader: LoaderKind) -> bool {
    matches!(loader, LoaderKind::Fabric | LoaderKind::Quilt)
}

/// Whether a file in `mods` is this mod's jar, enabled or disabled.
fn is_jar_of(known: &Known, file_name: &str) -> bool {
    let name = file_name.to_ascii_lowercase();
    (name.ends_with(".jar") || name.ends_with(".jar.disabled"))
        && name.starts_with(known.file_prefix)
        && !NOT_THESE.iter().any(|other| name.starts_with(other))
}

fn has(known: &Known, instance: &Instance, mod_files: &[String]) -> bool {
    instance.installed_projects.iter().any(|p| p.project_id == known.project_id)
        || mod_files.iter().any(|file| is_jar_of(known, file))
}

/// What the instance has and what Modrinth offers it. Fails only when Modrinth can't be reached:
/// an unknown answer is never shown as "not available".
async fn survey(state: &AppState, instance: &Instance) -> Result<Vec<PerformanceMod>> {
    let mods_dir = game_dir(&state.paths, instance).join("mods");
    let mod_files: Vec<String> = std::fs::read_dir(&mods_dir)
        .map(|entries| entries.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default();
    let client = ModrinthClient::new(state.http.clone(), state.modrinth_base().await);
    let game_versions = vec![instance.game_version.clone()];
    let loaders = vec![instance.loader.modrinth_name().to_string()];

    let mut list = Vec::with_capacity(KNOWN.len());
    for known in KNOWN {
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
            // Strictly this game version and this loader: the general installer falls back to
            // the newest version of anything, which would be the wrong build here.
            let versions = client.versions(known.project_id, &game_versions, &loaders).await?;
            match newest_stable(versions) {
                Some(version) => {
                    entry.state = PerformanceState::Available;
                    entry.version_id = Some(version.id);
                    entry.version_name = Some(version.version_number);
                }
                None => entry.state = PerformanceState::Unavailable,
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
/// as the status, with each mod's outcome; one mod failing doesn't stop the others.
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
    for entry in list.iter_mut().filter(|e| e.state == PerformanceState::Available) {
        // A mod installed a moment ago may have brought this one along as a dependency.
        let already = state
            .instances
            .read()
            .await
            .get(&instance_id)
            .is_ok_and(|i| i.installed_projects.iter().any(|p| p.project_id == entry.project_id));
        if already {
            entry.state = PerformanceState::Added;
            continue;
        }
        match modrinth_install(app.clone(), state.clone(), instance_id.clone(), entry.project_id.clone(), entry.version_id.clone()).await {
            Ok(_) => entry.state = PerformanceState::Added,
            Err(error) => {
                entry.state = PerformanceState::Failed;
                entry.detail = Some(error.to_string());
            }
        }
    }
    Ok(list)
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
    fn only_fabric_and_quilt_are_offered() {
        assert!(supports(LoaderKind::Fabric));
        assert!(supports(LoaderKind::Quilt));
        assert!(!supports(LoaderKind::Vanilla));
        assert!(!supports(LoaderKind::Forge));
        assert!(!supports(LoaderKind::NeoForge));
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
