use std::env;
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct Timing {
    t0: Instant,
    enabled: bool,
    benchmark: bool,
    marks: std::sync::Arc<std::sync::Mutex<Vec<(String, u128)>>>,
}

impl Timing {
    pub fn new() -> Self {
        let enabled = env::var("DDD_APPLET_TIMING").as_deref() == Ok("1");
        let benchmark = env::var("DDD_APPLET_BENCHMARK").as_deref() == Ok("1");
        Self {
            t0: Instant::now(),
            enabled: enabled || benchmark,
            benchmark,
            marks: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    pub fn mark(&self, label: &str) {
        if !self.enabled {
            return;
        }
        let ms = self.t0.elapsed().as_millis();
        self.marks
            .lock()
            .expect("timing lock")
            .push((label.to_string(), ms));
    }

    pub fn print_summary(&self, diagram_path: &str) {
        if !self.enabled {
            return;
        }
        let marks = self.marks.lock().expect("timing lock");
        eprintln!("[ddd-applet-rust timing] {diagram_path}");
        for (label, ms) in marks.iter() {
            eprintln!("  {label:<22} {ms}ms");
        }
        if let Some((_, ms)) = marks.iter().find(|(label, _)| label == "diagram-render") {
            eprintln!("  {:<22} {ms}ms", "→ interactive");
        }
    }

    pub fn should_exit_on_render(&self) -> bool {
        self.benchmark
    }
}

pub const AUTO_SAVE_DELAY: Duration = Duration::from_millis(300);
