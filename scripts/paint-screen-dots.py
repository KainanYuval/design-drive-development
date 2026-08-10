#!/usr/bin/env python3
"""
Paint an Excalidraw diagram region dark blue, one dot per disk write.

Each dot is a small ellipse written atomically so the DDD extension can undo
agent changes one dot at a time (Cmd+Z in the editor tab).

Follows DDD agent-turn and write-lock conventions.

Examples:
  # Preview dot count for the default full-canvas region
  python3 scripts/paint-screen-dots.py architecture.excalidraw --dry-run

  # Paint with coarser spacing (fewer dots, faster)
  python3 scripts/paint-screen-dots.py architecture.excalidraw --spacing 32

  # Dense fill (may freeze the editor — not recommended)
  python3 scripts/paint-screen-dots.py architecture.excalidraw --spacing 12 --force

  # Live interaction mode (~30fps batched writes for incremental canvas patches)
  python3 scripts/paint-screen-dots.py architecture.excalidraw --live --force

Note: More than ~500 individual dot elements can freeze the DDD editor webview.
Use --live with the live-interaction-mode branch for ~30fps incremental rendering.
For a solid fill, prefer a single rectangle instead of this script.

  # Custom viewport rectangle: x y width height
  python3 scripts/paint-screen-dots.py architecture.excalidraw --region 0 0 1200 960
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

DARK_BLUE = "#1864ab"
DOT_GROUP = "dark-blue-dot-fill"
AGENT_TURN_SUFFIX = ".ddd-agent-turn.lock"
WRITE_LOCK_SUFFIX = ".ddd-write.lock"
DEFAULT_REGION = (0, 0, 1200, 960)
DEFAULT_SPACING = 24
DEFAULT_DOT_SIZE = 10
DEFAULT_DELAY_MS = 40
DEFAULT_MAX_DOTS = 500
LIVE_FRAME_MS = 33
DEFAULT_LIVE_BATCH = 40


def agent_lock_path(diagram_path: str) -> str:
    return diagram_path + AGENT_TURN_SUFFIX


def write_lock_path(diagram_path: str) -> str:
    return diagram_path + WRITE_LOCK_SUFFIX


def wait_no_write_lock(diagram_path: str, timeout_s: float = 15.0) -> None:
    lock = write_lock_path(diagram_path)
    deadline = time.monotonic() + timeout_s
    while os.path.exists(lock):
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Timed out waiting for {lock}")
        time.sleep(0.05)


def read_diagram(diagram_path: str) -> dict[str, Any]:
    with open(diagram_path, encoding="utf-8") as f:
        return json.load(f)


def write_diagram(diagram_path: str, data: dict[str, Any]) -> None:
    wait_no_write_lock(diagram_path)
    tmp = diagram_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, diagram_path)


def is_blue_dot(element: dict[str, Any]) -> bool:
    elem_id = element.get("id", "")
    groups = element.get("groupIds") or []
    return elem_id.startswith("blue-dot-") or DOT_GROUP in groups


def dot_positions(
    x: float, y: float, width: float, height: float, spacing: float, dot_size: float
) -> list[tuple[int, int, int, int]]:
    """Return (col, row, x, y) positions for dot top-left corners."""
    positions: list[tuple[int, int, int, int]] = []
    cols = max(1, int(math.floor((width - dot_size) / spacing)) + 1)
    rows = max(1, int(math.floor((height - dot_size) / spacing)) + 1)
    for row in range(rows):
        for col in range(cols):
            cx = x + col * spacing
            cy = y + row * spacing
            positions.append((col, row, int(round(cx)), int(round(cy))))
    return positions


def make_dot_element(
    col: int, row: int, cx: int, cy: int, dot_size: float, seq: int
) -> dict[str, Any]:
    now = int(time.time() * 1000) + seq
    elem_id = f"blue-dot-{col}-{row}"
    return {
        "angle": 0,
        "fillStyle": "solid",
        "strokeWidth": 1,
        "strokeStyle": "solid",
        "roughness": 0,
        "opacity": 100,
        "groupIds": [DOT_GROUP],
        "frameId": None,
        "isDeleted": False,
        "boundElements": [],
        "link": None,
        "locked": False,
        "strokeColor": DARK_BLUE,
        "backgroundColor": DARK_BLUE,
        "id": elem_id,
        "type": "ellipse",
        "x": cx,
        "y": cy,
        "width": dot_size,
        "height": dot_size,
        "roundness": {"type": 2},
        "index": f"d{seq}",
        "version": 1,
        "versionNonce": now,
        "updated": now,
        "seed": (col * 997 + row * 17) % 100_000,
        "customData": {"kind": "decoration", "role": "blue-dot-fill"},
    }


def create_agent_lock(diagram_path: str, live: bool = False) -> None:
    payload = {
        "kind": "agent-turn",
        "label": "Painting dots",
        "pid": os.getpid(),
        "startedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    }
    if live:
        payload["liveInteraction"] = True
    with open(agent_lock_path(diagram_path), "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


def remove_agent_lock(diagram_path: str) -> None:
    path = agent_lock_path(diagram_path)
    if os.path.exists(path):
        os.remove(path)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fill an Excalidraw region with dark blue dots, one write per dot."
    )
    parser.add_argument(
        "diagram",
        help="Path to .excalidraw file (e.g. architecture.excalidraw)",
    )
    parser.add_argument(
        "--region",
        type=float,
        nargs=4,
        metavar=("X", "Y", "WIDTH", "HEIGHT"),
        default=list(DEFAULT_REGION),
        help=f"Paint rectangle (default: {' '.join(map(str, DEFAULT_REGION))})",
    )
    parser.add_argument(
        "--spacing",
        type=float,
        default=DEFAULT_SPACING,
        help=f"Distance between dot centers in px (default: {DEFAULT_SPACING})",
    )
    parser.add_argument(
        "--dot-size",
        type=float,
        default=DEFAULT_DOT_SIZE,
        help=f"Dot diameter in px (default: {DEFAULT_DOT_SIZE})",
    )
    parser.add_argument(
        "--delay-ms",
        type=int,
        default=DEFAULT_DELAY_MS,
        help=f"Pause between writes in ms (default: {DEFAULT_DELAY_MS})",
    )
    parser.add_argument(
        "--max-dots",
        type=int,
        default=DEFAULT_MAX_DOTS,
        help=f"Refuse to run above this count unless --force (default: {DEFAULT_MAX_DOTS})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Run even if dot count exceeds --max-dots",
    )
    parser.add_argument(
        "--clear-existing",
        action="store_true",
        help="Remove prior blue-dot elements before painting",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned dot count and exit without writing",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help=f"Batch dots into ~30fps disk writes (frame={LIVE_FRAME_MS}ms)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_LIVE_BATCH,
        help=f"Dots added per live frame (default: {DEFAULT_LIVE_BATCH})",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    diagram_path = os.path.abspath(args.diagram)

    if not os.path.isfile(diagram_path):
        print(f"error: diagram not found: {diagram_path}", file=sys.stderr)
        return 1

    rx, ry, rw, rh = args.region
    if args.spacing <= 0 or args.dot_size <= 0:
        print("error: --spacing and --dot-size must be positive", file=sys.stderr)
        return 1

    grid = dot_positions(rx, ry, rw, rh, args.spacing, args.dot_size)
    total = len(grid)

    print(
        f"region=({rx},{ry},{rw}x{rh}) spacing={args.spacing}px "
        f"dot={args.dot_size}px → {total} dots",
        file=sys.stderr,
    )

    if args.dry_run:
        return 0

    if total > args.max_dots and not args.force:
        print(
            f"error: {total} dots exceeds --max-dots {args.max_dots}. "
            f"Increase --spacing, shrink --region, or pass --force.",
            file=sys.stderr,
        )
        return 1

    create_agent_lock(diagram_path, live=args.live)
    print("agent turn lock created", file=sys.stderr)

    frame_delay = LIVE_FRAME_MS / 1000 if args.live else args.delay_ms / 1000
    if args.live:
        print(
            f"live mode: {args.batch_size} dots/frame @ {LIVE_FRAME_MS}ms (~30fps patches)",
            file=sys.stderr,
        )

    try:
        if args.clear_existing:
            data = read_diagram(diagram_path)
            before = len(data.get("elements", []))
            data["elements"] = [
                e for e in data.get("elements", []) if not is_blue_dot(e)
            ]
            removed = before - len(data["elements"])
            write_diagram(diagram_path, data)
            print(f"cleared {removed} existing blue dot(s)", file=sys.stderr)
            time.sleep(frame_delay)

        batch: list[tuple[int, int, int, int, int]] = []
        painted = 0

        for seq, (col, row, cx, cy) in enumerate(grid):
            batch.append((col, row, cx, cy, seq))
            is_last = seq + 1 == total
            if args.live and len(batch) < args.batch_size and not is_last:
                continue

            data = read_diagram(diagram_path)
            elements = data.setdefault("elements", [])
            added_this_frame = 0
            for col, row, cx, cy, dot_seq in batch:
                elem_id = f"blue-dot-{col}-{row}"
                if any(e.get("id") == elem_id for e in elements):
                    continue
                elements.append(
                    make_dot_element(col, row, cx, cy, args.dot_size, dot_seq)
                )
                added_this_frame += 1

            if added_this_frame > 0:
                write_diagram(diagram_path, data)
                painted += added_this_frame

            if painted > 0 and (painted % 25 == 0 or is_last):
                print(f"painted {painted}/{total} dots", file=sys.stderr)

            batch = []
            if frame_delay > 0 and not is_last:
                time.sleep(frame_delay)

        print(f"done — {painted} dots written to {diagram_path}", file=sys.stderr)
        return 0
    except KeyboardInterrupt:
        print("\ninterrupted — partial fill remains on disk", file=sys.stderr)
        return 130
    finally:
        remove_agent_lock(diagram_path)
        print("agent turn lock removed", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
