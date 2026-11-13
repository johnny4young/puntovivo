# 0033: el stack de escritorio sigue en Electron

**Idioma:** Español · [English](../../architecture/0033-desktop-stack-stays-on-electron.md)

> Estado: aceptada
> Fecha: 5 de noviembre de 2026

## Contexto

En noviembre de 2026 el mantenedor revisó el stack de cada app y comparó
Electron y SwiftUI con Go (Fyne, Wails) y Rust (Tauri, GPUI). La misma app
pequeña se construyó en los seis y se midió en Apple Silicon, y las bibliotecas
de producción de Puntovivo se auditaron contra cada ecosistema. Puntovivo se
distribuye para Windows, macOS y Linux, así que un reemplazo tenía que cubrir
los tres.

## Decisión

Puntovivo sigue en Electron. El trabajo va al arranque, la memoria, la CPU y el
tiempo de build dentro de Electron, como hace
[ADR-0032](./0032-embedded-server-worker-thread.md) con la respuesta del hilo
principal.

## Consecuencias

- Ninguna migración del shell empieza sin un ADR que reemplace a este.
- Si algún día se adopta GPUI, los crates GPL-3.0 de Zed (`ui`, `theme`,
  `editor`, `component`, `terminal`, `terminal_view`) quedan fuera; GPUI en sí
  es Apache-2.0.

## Alternativas descartadas

- Tauri o Wails: un webview del sistema ahorró tamaño del paquete, no memoria ni
  arranque.
- GPUI: la única ganancia clara de eficiencia, a costa de reescribir toda la
  interfaz.

## Verificación

Las mediciones y la auditoría de bibliotecas están en el informe de
investigación privado del mantenedor, no en este repositorio. Se tomaron con una
app de control pequeña en macOS; nada se midió en Windows, en Linux ni en
Puntovivo.
