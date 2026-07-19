mod host;
mod timing;

use clap::Parser;
use host::{build_init_script, spawn_file_watcher, UserEvent};
use http::{Response, StatusCode};
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tao::dpi::LogicalSize;
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;
use wry::http::Request;
use wry::WebViewBuilder;

#[derive(Parser, Debug)]
#[command(name = "ddd-applet-rust", about = "Design Drive Development Rust diagram applet")]
struct Cli {
    diagram: PathBuf,
}

fn dist_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
}

fn serve_asset(dist: &Path, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path();
    let relative = path.trim_start_matches('/');
    let relative = if relative.is_empty() { "index.html" } else { relative };

    let file_path = dist.join(relative);
    let Ok(content) = std::fs::read(&file_path) else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Cow::Owned(format!("missing asset: {relative}").into_bytes()))
            .unwrap_or_default();
    };

    let mime = mime_guess::from_path(&file_path)
        .first_or_text_plain()
        .essence_str()
        .to_string();

    Response::builder()
        .header(http::header::CONTENT_TYPE, mime)
        .body(Cow::Owned(content))
        .unwrap_or_default()
}

fn main() {
    let cli = Cli::parse();
    let timing = timing::Timing::new();
    timing.mark("process-start");

    let diagram_content = std::fs::read_to_string(&cli.diagram).unwrap_or_else(|error| {
        eprintln!("File not found: {} ({error})", cli.diagram.display());
        std::process::exit(1);
    });

    let init_script = build_init_script(&cli.diagram, &diagram_content);
    let dist = dist_dir();
    if !dist.join("webview.js").is_file() {
        eprintln!("Applet not built. Run: cd extension && npm run build:applet");
        std::process::exit(1);
    }

    timing.mark("session-init");

    let host = Arc::new(Mutex::new(host::HostSession::new(
        cli.diagram.clone(),
        diagram_content,
        timing.clone(),
    )));

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    spawn_file_watcher(cli.diagram.clone(), proxy.clone());

    let window = WindowBuilder::new()
        .with_title("Design Drive Development")
        .with_inner_size(LogicalSize::new(1280.0, 840.0))
        .build(&event_loop)
        .expect("create window");

    timing.mark("window-created");

    let host_ipc = host.clone();
    let host_watch = host.clone();
    let timing_build = timing.clone();
    let dist_protocol = dist.clone();

    let webview = WebViewBuilder::new()
        .with_custom_protocol("ddd".into(), move |_id, request| serve_asset(&dist_protocol, request))
        .with_url("ddd://localhost/index.html")
        .with_initialization_script(&init_script)
        .with_ipc_handler(move |request| {
            let _ = proxy.send_event(UserEvent::Ipc(request.body().clone()));
        })
        .build(&window)
        .expect("create webview");

    timing_build.mark("load-file-called");
    timing_build.mark("app-ready");

    let mut dom_ready_marked = false;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::WaitUntil(Instant::now() + std::time::Duration::from_millis(16));

        if let Ok(mut session) = host.lock() {
            session.tick_autosave();
        }

        match event {
            Event::NewEvents(StartCause::Init) => {}
            Event::UserEvent(user_event) => match user_event {
                UserEvent::Ipc(body) => {
                    if !dom_ready_marked {
                        dom_ready_marked = true;
                        timing.mark("dom-ready");
                    }
                    let message: serde_json::Value =
                        serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
                    let mut session = host_ipc.lock().expect("host lock");
                    if session.handle_message(&message, &webview) {
                        session.flush_save();
                        std::process::exit(0);
                    }
                }
                UserEvent::FileChanged => {
                    let mut session = host_watch.lock().expect("host lock");
                    session.push_latest_from_disk(&webview, false, true);
                }
            },
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                if let Ok(mut session) = host_ipc.lock() {
                    session.flush_save();
                }
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}
