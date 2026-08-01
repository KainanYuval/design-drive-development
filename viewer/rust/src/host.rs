use crate::timing::{self, Timing};
use notify::Watcher;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use wry::WebView;

const EMPTY_EXCALIDRAW_JSON: &str = r##"{
  "type": "excalidraw",
  "version": 2,
  "source": "design-drive-development",
  "elements": [],
  "appState": {
    "gridSize": 20,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}"##;

const AGENT_TURN_LOCK_SUFFIX: &str = ".ddd-agent-turn.lock";
const WATCH_DEBOUNCE_MS: u64 = 50;
const AGENT_TURN_WATCH_DEBOUNCE_MS: u64 = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SyncPhase {
    Booting,
    Synced,
    HumanDirty,
    SavingHuman,
    ApplyingAgent,
    AgentConflict,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LoadOrigin {
    Initial,
    Agent,
    ConflictResolution,
}

impl LoadOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::Initial => "initial",
            Self::Agent => "agent",
            Self::ConflictResolution => "conflict-resolution",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum SyncEffect {
    LoadCanvas {
        generation: u64,
        hash: String,
        origin: LoadOrigin,
    },
    SaveHuman {
        expected_disk_hash: String,
        human_hash: String,
    },
    PreserveConflict {
        agent_hash: String,
        human_hash: String,
        base_hash: String,
    },
}

#[derive(Clone, Debug)]
struct SyncCoordinator {
    phase: SyncPhase,
    base_hash: String,
    canvas_hash: String,
    disk_hash: String,
    generation: u64,
    awaiting_hash: Option<String>,
    saving_hash: Option<String>,
    agent_turn_active: bool,
}

impl SyncCoordinator {
    fn new(initial_disk_hash: String) -> Self {
        Self {
            phase: SyncPhase::Booting,
            base_hash: initial_disk_hash.clone(),
            canvas_hash: initial_disk_hash.clone(),
            disk_hash: initial_disk_hash,
            generation: 0,
            awaiting_hash: None,
            saving_hash: None,
            agent_turn_active: false,
        }
    }

    fn begin_agent_turn(&mut self) {
        self.agent_turn_active = true;
        self.awaiting_hash = None;
        self.saving_hash = None;
        if matches!(
            self.phase,
            SyncPhase::HumanDirty | SyncPhase::SavingHuman | SyncPhase::AgentConflict
        ) {
            self.phase = SyncPhase::Synced;
            self.canvas_hash = self.base_hash.clone();
        }
    }

    fn end_agent_turn(&mut self) {
        self.agent_turn_active = false;
    }

    fn is_agent_turn_active(&self) -> bool {
        self.agent_turn_active
    }

    fn bootstrap(&mut self, hash: String) -> Vec<SyncEffect> {
        self.disk_hash = hash.clone();
        vec![self.begin_load(hash, LoadOrigin::Initial)]
    }

    fn canvas_changed(&mut self, hash: String) {
        if self.agent_turn_active {
            return;
        }
        if hash == self.canvas_hash {
            return;
        }
        self.canvas_hash = hash;
        self.phase = SyncPhase::HumanDirty;
        self.awaiting_hash = None;
    }

    fn disk_observed(&mut self, hash: String) -> Vec<SyncEffect> {
        self.disk_hash = hash.clone();
        if self.agent_turn_active {
            if hash == self.canvas_hash && self.phase == SyncPhase::Synced {
                return vec![];
            }
            if self.phase == SyncPhase::ApplyingAgent
                && self.awaiting_hash.as_deref() == Some(hash.as_str())
            {
                return vec![];
            }
            return vec![self.begin_load(hash, LoadOrigin::Agent)];
        }
        if hash == self.canvas_hash {
            if self.phase != SyncPhase::SavingHuman {
                self.mark_synced(hash);
            }
            return vec![];
        }
        if matches!(self.phase, SyncPhase::HumanDirty | SyncPhase::SavingHuman)
            && hash == self.base_hash
        {
            return vec![];
        }
        if matches!(
            self.phase,
            SyncPhase::HumanDirty | SyncPhase::SavingHuman | SyncPhase::AgentConflict
        ) {
            self.phase = SyncPhase::AgentConflict;
            return vec![SyncEffect::PreserveConflict {
                agent_hash: hash,
                human_hash: self.canvas_hash.clone(),
                base_hash: self.base_hash.clone(),
            }];
        }
        if self.phase == SyncPhase::ApplyingAgent
            && self.awaiting_hash.as_deref() == Some(hash.as_str())
        {
            return vec![];
        }
        vec![self.begin_load(hash, LoadOrigin::Agent)]
    }

    fn request_human_save(&mut self) -> Vec<SyncEffect> {
        if self.agent_turn_active {
            return vec![];
        }
        if !matches!(self.phase, SyncPhase::HumanDirty | SyncPhase::AgentConflict) {
            return vec![];
        }
        let expected_disk_hash = if self.phase == SyncPhase::AgentConflict {
            self.disk_hash.clone()
        } else {
            self.base_hash.clone()
        };
        self.phase = SyncPhase::SavingHuman;
        self.saving_hash = Some(self.canvas_hash.clone());
        vec![SyncEffect::SaveHuman {
            expected_disk_hash,
            human_hash: self.canvas_hash.clone(),
        }]
    }

    fn human_save_succeeded(&mut self, saved_hash: String) {
        self.disk_hash = saved_hash.clone();
        self.base_hash = saved_hash.clone();
        self.saving_hash = None;
        if self.canvas_hash == saved_hash {
            self.mark_synced(saved_hash);
        } else {
            self.phase = SyncPhase::HumanDirty;
        }
    }

    fn human_save_failed(&mut self) {
        self.saving_hash = None;
        self.phase = SyncPhase::HumanDirty;
    }

    fn human_save_lost_race(&mut self, agent_hash: String) -> Vec<SyncEffect> {
        self.disk_hash = agent_hash.clone();
        self.phase = SyncPhase::AgentConflict;
        vec![SyncEffect::PreserveConflict {
            agent_hash,
            human_hash: self.canvas_hash.clone(),
            base_hash: self.base_hash.clone(),
        }]
    }

    fn load_applied(&mut self, generation: u64, applied_hash: &str) -> bool {
        if generation != self.generation || self.awaiting_hash.as_deref() != Some(applied_hash) {
            return false;
        }
        self.canvas_hash = applied_hash.to_string();
        self.mark_synced(applied_hash.to_string());
        true
    }

    fn accept_external(&mut self, hash: String) -> Vec<SyncEffect> {
        self.disk_hash = hash.clone();
        vec![self.begin_load(hash, LoadOrigin::ConflictResolution)]
    }

    fn begin_load(&mut self, hash: String, origin: LoadOrigin) -> SyncEffect {
        self.generation += 1;
        self.phase = SyncPhase::ApplyingAgent;
        self.awaiting_hash = Some(hash.clone());
        SyncEffect::LoadCanvas {
            generation: self.generation,
            hash,
            origin,
        }
    }

    fn mark_synced(&mut self, hash: String) {
        self.phase = SyncPhase::Synced;
        self.base_hash = hash.clone();
        self.canvas_hash = hash.clone();
        self.disk_hash = hash;
        self.awaiting_hash = None;
        self.saving_hash = None;
    }
}

pub struct HostSession {
    diagram_path: PathBuf,
    diagram_content: String,
    sync: SyncCoordinator,
    content_by_hash: HashMap<String, String>,
    pending_load_content: HashMap<u64, String>,
    webview_ready: bool,
    accept_webview_edits: bool,
    save_deadline: Option<Instant>,
    timing: Timing,
    reload_delay_ms: u64,
}

impl HostSession {
    pub fn new(diagram_path: PathBuf, content: String, timing: Timing) -> Self {
        let diagram_content = normalize_diagram_text(&content);
        let content_hash = hash_content(&diagram_content);
        let mut content_by_hash = HashMap::new();
        content_by_hash.insert(content_hash.clone(), diagram_content.clone());
        Self {
            diagram_path,
            diagram_content,
            sync: SyncCoordinator::new(content_hash),
            content_by_hash,
            pending_load_content: HashMap::new(),
            webview_ready: false,
            accept_webview_edits: false,
            save_deadline: None,
            timing,
            reload_delay_ms: WATCH_DEBOUNCE_MS,
        }
    }

    pub fn reload_delay_ms(&self) -> u64 {
        self.reload_delay_ms
    }

    fn agent_turn_lock_path(&self) -> PathBuf {
        PathBuf::from(format!(
            "{}{AGENT_TURN_LOCK_SUFFIX}",
            self.diagram_path.display()
        ))
    }

    fn read_agent_turn_lock(&self) -> Option<String> {
        let lock_path = self.agent_turn_lock_path();
        let raw = std::fs::read_to_string(&lock_path).ok()?;
        if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
            if parsed.get("kind").and_then(Value::as_str) == Some("agent-turn") {
                return parsed
                    .get("label")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|label| !label.is_empty())
                    .map(str::to_string)
                    .or_else(|| Some("Agent turn".to_string()));
            }
        }
        Some("Agent turn".to_string())
    }

    fn push_agent_turn(&self, webview: &WebView, active: bool, label: &str) {
        let payload = json!({
            "type": "agentTurn",
            "active": active,
            "label": label,
        });
        let script = format!(
            "window.dispatchEvent(new MessageEvent('message', {{ data: {} }}));",
            serde_json::to_string(&payload).expect("serialize agent turn payload")
        );
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("[ddd-applet-rust] push agent turn failed: {error}");
        }
    }

    fn refresh_agent_turn_state(&mut self, webview: &WebView, reason: &str) {
        let lock_label = self.read_agent_turn_lock();
        if lock_label.is_some() && !self.sync.is_agent_turn_active() {
            self.sync.begin_agent_turn();
            self.accept_webview_edits = false;
            self.save_deadline = None;
            self.reload_delay_ms = AGENT_TURN_WATCH_DEBOUNCE_MS;
            self.push_agent_turn(
                webview,
                true,
                lock_label.as_deref().unwrap_or("Agent turn"),
            );
            eprintln!("[ddd-applet-rust] agent turn started ({reason})");
            self.push_latest_from_disk(webview, true, true);
            return;
        }
        if lock_label.is_none() && self.sync.is_agent_turn_active() {
            self.sync.end_agent_turn();
            self.reload_delay_ms = WATCH_DEBOUNCE_MS;
            self.push_agent_turn(webview, false, "Agent turn");
            eprintln!("[ddd-applet-rust] agent turn ended ({reason})");
            self.push_latest_from_disk(webview, true, true);
            return;
        }
        if let Some(label) = lock_label {
            if self.sync.is_agent_turn_active() {
                self.push_agent_turn(webview, true, &label);
            }
        }
    }

    pub fn handle_message(&mut self, message: &Value, webview: &WebView) -> bool {
        let msg_type = message.get("type").and_then(Value::as_str).unwrap_or("");

        match msg_type {
            "timing" if message.get("phase").and_then(Value::as_str) == Some("diagram-render") => {
                self.timing.mark("diagram-render");
                self.timing
                    .print_summary(self.diagram_path.to_string_lossy().as_ref());
                return self.timing.should_exit_on_render();
            }
            "ready" => {
                self.webview_ready = true;
                self.timing.mark("webview-ready");
                self.push_latest_from_disk(webview, true, false);
            }
            "loadApplied" => {
                if let (Some(generation), Some(applied_hash)) = (
                    message.get("generation").and_then(Value::as_u64),
                    message.get("appliedHash").and_then(Value::as_str),
                ) {
                    self.apply_webview_load(generation, applied_hash);
                }
            }
            "change" => {
                if let (Some(content), Some(based_on_generation)) = (
                    message.get("content").and_then(Value::as_str),
                    message.get("basedOnGeneration").and_then(Value::as_u64),
                ) {
                    self.handle_webview_change(content, based_on_generation, webview);
                }
            }
            "save" => {
                self.save_deadline = None;
                if let Err(error) = self.persist_to_disk(webview) {
                    eprintln!("[ddd-applet-rust] save failed: {error}");
                }
            }
            _ => {}
        }

        false
    }

    pub fn tick_autosave(&mut self, webview: &WebView) {
        let Some(deadline) = self.save_deadline else {
            return;
        };
        if Instant::now() < deadline {
            return;
        }
        self.save_deadline = None;
        if let Err(error) = self.persist_to_disk(webview) {
            eprintln!("[ddd-applet-rust] autosave failed: {error}");
        }
    }

    pub fn push_latest_from_disk(&mut self, webview: &WebView, force: bool, external: bool) {
        if !self.webview_ready {
            return;
        }

        self.refresh_agent_turn_state(webview, "watch");

        let raw_disk_text = match std::fs::read_to_string(&self.diagram_path) {
            Ok(text) => text,
            Err(error) => {
                eprintln!("[ddd-applet-rust] disk read failed: {error}");
                return;
            }
        };
        let disk_text = if is_valid_diagram_text(&raw_disk_text) {
            raw_disk_text.clone()
        } else if force && !external && raw_disk_text.trim().is_empty() {
            match conditional_atomic_write(
                &self.diagram_path,
                &hash_content(&raw_disk_text),
                EMPTY_EXCALIDRAW_JSON,
            ) {
                Ok(ConditionalWrite::Saved) => EMPTY_EXCALIDRAW_JSON.to_string(),
                Ok(ConditionalWrite::LostRace { content, .. }) => {
                    if is_valid_diagram_text(&content) {
                        content
                    } else {
                        return;
                    }
                }
                Err(error) => {
                    eprintln!("[ddd-applet-rust] normalize write failed: {error}");
                    return;
                }
            }
        } else {
            if force && !external {
                let effects = self.sync.bootstrap(hash_content(&self.diagram_content));
                if let Err(error) = self.execute_sync_effects(effects, webview) {
                    eprintln!("[ddd-applet-rust] bootstrap failed: {error}");
                }
            }
            return;
        };
        let disk_hash = hash_content(&disk_text);
        self.content_by_hash.insert(disk_hash.clone(), disk_text);
        let effects = if force && !external {
            self.sync.bootstrap(disk_hash)
        } else if force {
            self.sync.accept_external(disk_hash)
        } else {
            self.sync.disk_observed(disk_hash)
        };
        if let Err(error) = self.execute_sync_effects(effects, webview) {
            eprintln!("[ddd-applet-rust] sync failed: {error}");
        }
    }

    fn apply_webview_load(&mut self, generation: u64, applied_hash: &str) {
        if !self.sync.load_applied(generation, applied_hash) {
            eprintln!("[ddd-applet-rust] ignored stale load generation {generation}");
            return;
        }
        if let Some(content) = self
            .pending_load_content
            .get(&generation)
            .or_else(|| self.content_by_hash.get(applied_hash))
        {
            self.diagram_content = content.clone();
        }
        self.pending_load_content
            .retain(|pending_generation, _| *pending_generation > generation);
        self.accept_webview_edits = !self.sync.is_agent_turn_active();
    }

    fn handle_webview_change(
        &mut self,
        content: &str,
        based_on_generation: u64,
        webview: &WebView,
    ) {
        if !self.accept_webview_edits || self.sync.is_agent_turn_active() {
            return;
        }
        if based_on_generation != self.sync.generation {
            if self.sync.phase == SyncPhase::ApplyingAgent
                && based_on_generation < self.sync.generation
                && self.sync.awaiting_hash.is_some()
            {
                let generation = self.sync.generation;
                let awaiting_hash = self.sync.awaiting_hash.clone().unwrap_or_default();
                let next_hash = hash_content(content);
                if next_hash != self.sync.canvas_hash {
                    self.push_cancel_load(webview, generation);
                    self.push_adopt_generation(webview, generation);
                    self.diagram_content = content.to_string();
                    self.content_by_hash
                        .insert(next_hash.clone(), content.to_string());
                    self.sync.canvas_changed(next_hash);
                    let effects = self.sync.disk_observed(awaiting_hash);
                    if let Err(error) = self.execute_sync_effects(effects, webview) {
                        eprintln!("[ddd-applet-rust] interaction conflict failed: {error}");
                    }
                }
            }
            return;
        }
        let next_hash = hash_content(content);
        if next_hash == self.sync.canvas_hash {
            return;
        }
        self.diagram_content = content.to_string();
        self.content_by_hash
            .insert(next_hash.clone(), content.to_string());
        self.sync.canvas_changed(next_hash);
        self.save_deadline = Some(Instant::now() + timing::AUTO_SAVE_DELAY);
    }

    fn persist_to_disk(&mut self, webview: &WebView) -> std::io::Result<()> {
        self.save_deadline = None;
        let effects = self.sync.request_human_save();
        if let Err(error) = self.execute_sync_effects(effects, webview) {
            self.sync.human_save_failed();
            self.save_deadline = Some(Instant::now() + timing::AUTO_SAVE_DELAY);
            return Err(error);
        }
        Ok(())
    }

    fn execute_sync_effects(
        &mut self,
        effects: Vec<SyncEffect>,
        webview: &WebView,
    ) -> std::io::Result<()> {
        for effect in effects {
            match effect {
                SyncEffect::LoadCanvas {
                    generation,
                    hash,
                    origin,
                } => {
                    let Some(content) = self.content_by_hash.get(&hash).cloned() else {
                        continue;
                    };
                    self.pending_load_content
                        .insert(generation, content.clone());
                    self.push_load(webview, &content, generation, &hash, origin);
                }
                SyncEffect::PreserveConflict {
                    agent_hash,
                    human_hash,
                    base_hash,
                } => {
                    self.preserve_agent_conflict(&agent_hash, &human_hash, &base_hash)?;
                    self.save_deadline = None;
                    let saves = self.sync.request_human_save();
                    self.execute_sync_effects(saves, webview)?;
                }
                SyncEffect::SaveHuman {
                    expected_disk_hash,
                    human_hash,
                } => {
                    self.perform_human_save(&expected_disk_hash, &human_hash, webview)?;
                }
            }
        }
        Ok(())
    }

    fn perform_human_save(
        &mut self,
        expected_disk_hash: &str,
        human_hash: &str,
        webview: &WebView,
    ) -> std::io::Result<()> {
        let Some(human_content) = self.content_by_hash.get(human_hash).cloned() else {
            self.sync.human_save_failed();
            return Ok(());
        };
        match conditional_atomic_write(&self.diagram_path, expected_disk_hash, &human_content)? {
            ConditionalWrite::Saved => {
                self.sync.human_save_succeeded(human_hash.to_string());
                self.diagram_content = human_content;
                if self.sync.phase == SyncPhase::HumanDirty {
                    self.save_deadline = Some(Instant::now() + timing::AUTO_SAVE_DELAY);
                }
            }
            ConditionalWrite::LostRace { hash, content } => {
                if !is_valid_diagram_text(&content) {
                    self.sync.human_save_failed();
                    return Ok(());
                }
                self.content_by_hash.insert(hash.clone(), content);
                let conflicts = self.sync.human_save_lost_race(hash);
                self.execute_sync_effects(conflicts, webview)?;
            }
        }
        Ok(())
    }

    fn preserve_agent_conflict(
        &self,
        agent_hash: &str,
        human_hash: &str,
        base_hash: &str,
    ) -> std::io::Result<()> {
        let Some(agent_content) = self.content_by_hash.get(agent_hash) else {
            return Ok(());
        };
        let extension = self
            .diagram_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let stem = self
            .diagram_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("diagram");
        let parent = self.diagram_path.parent().unwrap_or_else(|| Path::new("."));
        let candidate_name = if extension.is_empty() {
            format!("{stem}.agent-conflict")
        } else {
            format!("{stem}.agent-conflict.{extension}")
        };
        let candidate_path = parent.join(&candidate_name);
        let metadata_path = parent.join(format!("{stem}.agent-conflict.json"));
        std::fs::write(&candidate_path, agent_content)?;
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let metadata = serde_json::to_string_pretty(&json!({
            "diagram": self.diagram_path.file_name().and_then(|value| value.to_str()).unwrap_or(""),
            "createdAt": created_at,
            "baseHash": base_hash,
            "humanHash": human_hash,
            "agentHash": agent_hash,
            "policy": "human-open-session-wins",
            "candidate": candidate_name,
        }))?;
        std::fs::write(metadata_path, metadata)?;
        eprintln!("[ddd-applet-rust] preserved agent conflict → {candidate_name}");
        Ok(())
    }

    fn push_load(
        &self,
        webview: &WebView,
        content: &str,
        generation: u64,
        hash: &str,
        origin: LoadOrigin,
    ) {
        let payload = json!({
            "type": "load",
            "content": content,
            "external": origin != LoadOrigin::Initial,
            "generation": generation,
            "hash": hash,
            "origin": origin.as_str(),
            "agentTurn": self.sync.is_agent_turn_active(),
        });
        let script = format!(
            "window.dispatchEvent(new MessageEvent('message', {{ data: {} }}));",
            serde_json::to_string(&payload).expect("serialize load payload")
        );
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("[ddd-applet-rust] push load failed: {error}");
        }
    }

    fn push_cancel_load(&self, webview: &WebView, generation: u64) {
        let payload = json!({
            "type": "cancelLoad",
            "generation": generation,
        });
        let script = format!(
            "window.dispatchEvent(new MessageEvent('message', {{ data: {} }}));",
            serde_json::to_string(&payload).expect("serialize cancel payload")
        );
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("[ddd-applet-rust] cancel load failed: {error}");
        }
    }

    fn push_adopt_generation(&self, webview: &WebView, generation: u64) {
        let payload = json!({
            "type": "adoptGeneration",
            "generation": generation,
        });
        let script = format!(
            "window.dispatchEvent(new MessageEvent('message', {{ data: {} }}));",
            serde_json::to_string(&payload).expect("serialize generation payload")
        );
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("[ddd-applet-rust] adopt generation failed: {error}");
        }
    }

    pub fn flush_save(&mut self, webview: &WebView) {
        self.save_deadline = None;
        if let Err(error) = self.persist_to_disk(webview) {
            eprintln!("[ddd-applet-rust] flush save failed: {error}");
        }
    }
}

pub fn hash_content(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn normalize_diagram_text(text: &str) -> String {
    if is_valid_diagram_text(text) {
        text.to_string()
    } else {
        EMPTY_EXCALIDRAW_JSON.to_string()
    }
}

fn is_valid_diagram_text(text: &str) -> bool {
    serde_json::from_str::<Value>(text.trim())
        .ok()
        .is_some_and(|value| {
            value.get("type").and_then(Value::as_str) == Some("excalidraw")
                && value.get("elements").and_then(Value::as_array).is_some()
                && value.get("files").and_then(Value::as_object).is_some()
        })
}

enum ConditionalWrite {
    Saved,
    LostRace { hash: String, content: String },
}

fn conditional_atomic_write(
    path: &Path,
    expected_disk_hash: &str,
    content: &str,
) -> std::io::Result<ConditionalWrite> {
    let _lock = acquire_write_lock(path)?;
    let current = std::fs::read_to_string(path).unwrap_or_default();
    let current_hash = hash_content(&current);
    if current_hash != expected_disk_hash {
        return Ok(ConditionalWrite::LostRace {
            hash: current_hash,
            content: current,
        });
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = path.with_extension(format!(
        "{}.ddd-{}-{nonce}.tmp",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or(""),
        std::process::id()
    ));
    std::fs::write(&temp_path, content)?;
    let result = (|| {
        let before_rename = std::fs::read_to_string(path).unwrap_or_default();
        let before_rename_hash = hash_content(&before_rename);
        if before_rename_hash != expected_disk_hash {
            return Ok(ConditionalWrite::LostRace {
                hash: before_rename_hash,
                content: before_rename,
            });
        }
        #[cfg(windows)]
        {
            std::fs::write(path, content)?;
            let _ = std::fs::remove_file(&temp_path);
        }
        #[cfg(not(windows))]
        std::fs::rename(&temp_path, path)?;
        Ok(ConditionalWrite::Saved)
    })();
    let _ = std::fs::remove_file(temp_path);
    result
}

struct WriteLock {
    path: PathBuf,
}

impl Drop for WriteLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn acquire_write_lock(path: &Path) -> std::io::Result<WriteLock> {
    let lock_path = PathBuf::from(format!("{}.ddd-write.lock", path.display()));
    for _ in 0..100 {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                use std::io::Write;
                writeln!(
                    file,
                    "{{\"pid\":{},\"createdAt\":{}}}",
                    std::process::id(),
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis()
                )?;
                return Ok(WriteLock { path: lock_path });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = std::fs::metadata(&lock_path)
                    .and_then(|metadata| metadata.modified())
                    .ok()
                    .and_then(|modified| modified.elapsed().ok())
                    .is_some_and(|age| age > std::time::Duration::from_secs(30));
                if stale {
                    let _ = std::fs::remove_file(&lock_path);
                    continue;
                }
                thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::WouldBlock,
        format!(
            "timed out waiting for diagram write lock: {}",
            lock_path.display()
        ),
    ))
}

pub fn build_init_script(path: &Path, content: &str) -> String {
    let content = normalize_diagram_text(content);
    let payload = json!({
        "path": path.to_string_lossy(),
        "content": content,
    });
    let initial = serde_json::to_string(&payload).expect("serialize initial diagram");
    format!(
        r#"
window.acquireVsCodeApi = function() {{
  return {{
    postMessage: function(msg) {{ window.ipc.postMessage(JSON.stringify(msg)); }},
    getState: function() {{ return {{}}; }},
    setState: function() {{}}
  }};
}};
window.__DDD_APPLET__ = true;
window.__DDD_INITIAL_DIAGRAM__ = {initial};
"#
    )
}

pub fn spawn_file_watcher(
    diagram_path: PathBuf,
    proxy: tao::event_loop::EventLoopProxy<UserEvent>,
) {
    thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let watched_path = diagram_path.clone();
        let lock_path = PathBuf::from(format!(
            "{}{AGENT_TURN_LOCK_SUFFIX}",
            diagram_path.display()
        ));
        let lock_path_for_watcher = lock_path.clone();
        let mut watcher =
            match notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                if result.as_ref().is_ok_and(|event| {
                    event
                        .paths
                        .iter()
                        .any(|path| path == &watched_path || path == &lock_path_for_watcher)
                }) {
                    let _ = tx.send(());
                }
            }) {
                Ok(watcher) => watcher,
                Err(error) => {
                    eprintln!("[ddd-applet-rust] watcher failed: {error}");
                    return;
                }
            };

        let watch_target = diagram_path.parent().unwrap_or_else(|| Path::new("."));
        if let Err(error) = watcher.watch(watch_target, notify::RecursiveMode::NonRecursive) {
            eprintln!("[ddd-applet-rust] watcher failed: {error}");
            return;
        }

        while rx.recv().is_ok() {
            let delay_ms = if lock_path.exists() {
                AGENT_TURN_WATCH_DEBOUNCE_MS
            } else {
                WATCH_DEBOUNCE_MS
            };
            thread::sleep(std::time::Duration::from_millis(delay_ms));
            let _ = proxy.send_event(UserEvent::FileChanged);
        }
    });
}

#[derive(Clone, Debug)]
pub enum UserEvent {
    Ipc(String),
    FileChanged,
}

#[cfg(test)]
mod tests {
    use super::{
        is_valid_diagram_text, LoadOrigin, SyncCoordinator, SyncEffect, SyncPhase,
        EMPTY_EXCALIDRAW_JSON,
    };

    fn synced() -> SyncCoordinator {
        let mut sync = SyncCoordinator::new("base".into());
        sync.bootstrap("base".into());
        assert!(sync.load_applied(1, "base"));
        sync
    }

    #[test]
    fn bootstrap_requires_matching_generation_ack() {
        let mut sync = SyncCoordinator::new("disk-a".into());
        assert_eq!(
            sync.bootstrap("disk-a".into()),
            vec![SyncEffect::LoadCanvas {
                generation: 1,
                hash: "disk-a".into(),
                origin: LoadOrigin::Initial,
            }]
        );
        assert!(!sync.load_applied(0, "disk-a"));
        assert_eq!(sync.phase, SyncPhase::ApplyingAgent);
        assert!(sync.load_applied(1, "disk-a"));
        assert_eq!(sync.phase, SyncPhase::Synced);
    }

    #[test]
    fn only_schema_valid_diagrams_are_accepted() {
        assert!(is_valid_diagram_text(EMPTY_EXCALIDRAW_JSON));
        for invalid in ["", "{", "null", "[]", "{}", r#"{"type":"excalidraw"}"#] {
            assert!(!is_valid_diagram_text(invalid));
        }
    }

    #[test]
    fn own_save_echo_does_not_reload() {
        let mut sync = synced();
        sync.canvas_changed("human".into());
        assert_eq!(
            sync.request_human_save(),
            vec![SyncEffect::SaveHuman {
                expected_disk_hash: "base".into(),
                human_hash: "human".into(),
            }]
        );
        sync.human_save_succeeded("human".into());
        assert!(sync.disk_observed("human".into()).is_empty());
    }

    #[test]
    fn human_dirty_preserves_agent_and_restores_human() {
        let mut sync = synced();
        sync.canvas_changed("human".into());
        assert_eq!(
            sync.disk_observed("agent".into()),
            vec![SyncEffect::PreserveConflict {
                agent_hash: "agent".into(),
                human_hash: "human".into(),
                base_hash: "base".into(),
            }]
        );
        assert_eq!(
            sync.request_human_save(),
            vec![SyncEffect::SaveHuman {
                expected_disk_hash: "agent".into(),
                human_hash: "human".into(),
            }]
        );
    }

    #[test]
    fn rapid_agent_writes_only_latest_generation_can_ack() {
        let mut sync = synced();
        sync.disk_observed("agent-1".into());
        assert_eq!(
            sync.disk_observed("agent-2".into()),
            vec![SyncEffect::LoadCanvas {
                generation: 3,
                hash: "agent-2".into(),
                origin: LoadOrigin::Agent,
            }]
        );
        assert!(!sync.load_applied(2, "agent-1"));
        assert!(sync.load_applied(3, "agent-2"));
    }
}
