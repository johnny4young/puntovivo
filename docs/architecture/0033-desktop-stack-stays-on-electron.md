# 0033 — Desktop Stack Stays on Electron

**Language:** English · [Español](../es/architecture/0033-desktop-stack-stays-on-electron.md)

> Status: Accepted
> Date: 2026-11-05

## Context

In November 2026 the maintainer reviewed the stack of every app, comparing
Electron and SwiftUI with Go (Fyne, Wails) and Rust (Tauri, GPUI). The same
small app was built in all six and measured on Apple Silicon, and Puntovivo's
production libraries were audited against each ecosystem. Puntovivo ships for
Windows, macOS and Linux, so a replacement had to cover all three.

## Decision

Puntovivo stays on Electron. Work goes into startup, memory, CPU and build
time inside it, as [ADR-0032](./0032-embedded-server-worker-thread.md) does for
main-thread responsiveness.

## Consequences

- No shell migration starts without a successor ADR.
- If GPUI is ever adopted, Zed's GPL-3.0 crates (`ui`, `theme`, `editor`,
  `component`, `terminal`, `terminal_view`) stay out; GPUI itself is
  Apache-2.0.

## Alternatives rejected

- Tauri or Wails: a system webview saved bundle size, not memory or startup.
- GPUI: the only clear efficiency gain, at the cost of rewriting the whole UI.

## Verification

The measurements and the library audit are in the maintainer's private
research report, not in this repository. They used a small control app on
macOS; nothing was measured on Windows, on Linux or in Puntovivo itself.
