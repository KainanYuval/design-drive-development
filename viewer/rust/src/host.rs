use crate::timing::{self, Timing};
use notify::Watcher;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Instant;
use wry::WebView;

pub struct HostSession {
    diagram_path: PathBuf,
    diagram_content: String,
    content_hash: String,
    last_pushed_hash: String,
    last_webview_save_hash: String,
    webview_ready: bool,
    accept_webview_edits: bool,
    has_unsaved_webview_edits: bool,
    save_deadline: Option<Instant>,
    timing: Timing,
}

impl HostSession {
    pub fn new(diagram_path: PathBuf, content: String, timing: Timing) -> Self {
        let content_hash = hash_content(&content);
        Self {
            diagram_path,
            diagram_content: content,
            content_hash: content_hash.clone(),
            last_pushed_hash: content_hash.clone(),
            last_webview_save_hash: content_hash,
            webview_ready: false,
            accept_webview_edits: false,
            has_unsaved_webview_edits: false,
            save_deadline: None,
            timing,
        }
    }

    pub fn diagram_path(&self) -> &Path {
        &self.diagram_path
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
            "pull" => {
                self.push_latest_from_disk(webview, false, true);
            }
            "change" => {
                if let Some(content) = message.get("content").and_then(Value::as_str) {
                    self.handle_webview_change(content);
                }
            }
            "save" => {
                self.save_deadline = None;
                match self.persist_to_disk() {
                    Ok(need_push) if need_push => {
                        self.push_latest_from_disk(webview, true, true);
                    }
                    Err(error) => {
                        eprintln!("[ddd-applet-rust] save failed: {error}");
                    }
                    _ => {}
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
        match self.persist_to_disk() {
            Ok(need_push) if need_push => {
                self.push_latest_from_disk(webview, true, true);
            }
            Err(error) => {
                eprintln!("[ddd-applet-rust] autosave failed: {error}");
            }
            _ => {}
        }
    }

    pub fn push_latest_from_disk(&mut self, webview: &WebView, force: bool, external: bool) {
        if !self.webview_ready {
            return;
        }

        let disk_text = match std::fs::read_to_string(&self.diagram_path) {
            Ok(text) => text,
            Err(error) => {
                eprintln!("[ddd-applet-rust] disk read failed: {error}");
                return;
            }
        };

        let disk_hash = hash_content(&disk_text);
        if !force && self.has_unsaved_webview_edits && disk_hash == self.last_webview_save_hash {
            return;
        }
        if !force
            && self.has_unsaved_webview_edits
            && disk_hash != self.content_hash
            && disk_hash != self.last_webview_save_hash
        {
            self.has_unsaved_webview_edits = false;
            self.save_deadline = None;
        }
        if !force {
            if disk_hash == self.content_hash {
                self.last_pushed_hash = disk_hash;
                return;
            }
            if disk_hash == self.last_pushed_hash {
                return;
            }
        }

        self.diagram_content = disk_text;
        self.content_hash = disk_hash.clone();
        self.last_pushed_hash = disk_hash;
        self.accept_webview_edits = true;
        self.push_load(webview, external);
    }

    fn handle_webview_change(&mut self, content: &str) {
        if !self.accept_webview_edits {
            return;
        }
        let incoming_live = live_element_count_from_json(content);
        let current_live = live_element_count_from_json(&self.diagram_content);
        if incoming_live == 0 && current_live > 0 {
            return;
        }
        if !self.update_from_text(content) {
            return;
        }
        self.has_unsaved_webview_edits = true;
        self.save_deadline = Some(Instant::now() + timing::AUTO_SAVE_DELAY);
    }

    fn update_from_text(&mut self, text: &str) -> bool {
        let next_hash = hash_content(text);
        if next_hash == self.content_hash {
            return false;
        }
        self.diagram_content = text.to_string();
        self.content_hash = next_hash;
        true
    }

    fn persist_to_disk(&mut self) -> std::io::Result<bool> {
        let disk_text = std::fs::read_to_string(&self.diagram_path).unwrap_or_default();
        let disk_hash = hash_content(&disk_text);
        if disk_hash != self.content_hash && disk_hash != self.last_webview_save_hash {
            self.diagram_content = disk_text;
            self.content_hash = disk_hash.clone();
            self.has_unsaved_webview_edits = false;
            self.last_pushed_hash = disk_hash;
            self.last_webview_save_hash = self.content_hash.clone();
            return Ok(true);
        }
        let disk_live = live_element_count_from_json(&disk_text);
        let memory_live = live_element_count_from_json(&self.diagram_content);
        if memory_live < disk_live {
            self.diagram_content = disk_text;
            self.content_hash = hash_content(&self.diagram_content);
            self.has_unsaved_webview_edits = false;
            self.last_pushed_hash = self.content_hash.clone();
            self.last_webview_save_hash = self.content_hash.clone();
            return Ok(true);
        }
        std::fs::write(&self.diagram_path, &self.diagram_content)?;
        self.has_unsaved_webview_edits = false;
        self.last_pushed_hash = self.content_hash.clone();
        self.last_webview_save_hash = self.content_hash.clone();
        Ok(false)
    }

    fn push_load(&self, webview: &WebView, external: bool) {
        let payload = json!({
            "type": "load",
            "content": self.diagram_content,
            "external": external,
        });
        let script = format!(
            "window.dispatchEvent(new MessageEvent('message', {{ data: {} }}));",
            serde_json::to_string(&payload).expect("serialize load payload")
        );
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("[ddd-applet-rust] push load failed: {error}");
        }
    }

    pub fn flush_save(&mut self, webview: &WebView) {
        self.save_deadline = None;
        match self.persist_to_disk() {
            Ok(need_push) if need_push => {
                self.push_latest_from_disk(webview, true, true);
            }
            Err(error) => {
                eprintln!("[ddd-applet-rust] flush save failed: {error}");
            }
            _ => {}
        }
    }
}

pub fn hash_content(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn live_element_count_from_json(text: &str) -> usize {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return 0;
    };
    value
        .get("elements")
        .and_then(Value::as_array)
        .map(|elements| {
            elements
                .iter()
                .filter(|element| element.get("isDeleted").and_then(Value::as_bool) != Some(true))
                .count()
        })
        .unwrap_or(0)
}

pub fn build_init_script(path: &Path, content: &str) -> String {
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
        let mut watcher = match notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            if result.is_ok() {
                let _ = tx.send(());
            }
        }) {
            Ok(watcher) => watcher,
            Err(error) => {
                eprintln!("[ddd-applet-rust] watcher failed: {error}");
                return;
            }
        };

        if let Err(error) = watcher.watch(&diagram_path, notify::RecursiveMode::NonRecursive) {
            eprintln!("[ddd-applet-rust] watcher failed: {error}");
            return;
        }

        while rx.recv().is_ok() {
            thread::sleep(std::time::Duration::from_millis(50));
            let _ = proxy.send_event(UserEvent::FileChanged);
        }
    });
}

#[derive(Clone, Debug)]
pub enum UserEvent {
    Ipc(String),
    FileChanged,
}
