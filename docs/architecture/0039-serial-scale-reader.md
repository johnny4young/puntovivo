# 0039 — Serial scale reader in the desktop main process

**Language:** English · [Español](../es/architecture/0039-serial-scale-reader.md)

> Status: Accepted
> Date: 2026-11-21

## Context

Corner stores and butchers weigh loose goods. The weight panel offered weight
keys, sell by value and a typed weight, but a scale on the counter still meant
reading its display and typing the number. The renderer is sandboxed and cannot
open a serial port.

## Decision

- The Electron main process reads the scale through `@serialport/bindings-cpp`
  (MIT), loaded on first use. It ships Node-API prebuilds, so packaging keeps
  `npmRebuild: false`; the afterPack hook keeps only the target's prebuild
  folder and fails closed without it.
- The scale is configured per computer, not per site: the port belongs to the
  machine it is plugged into. Main stores one private file per tenant under
  `userData/scale-preferences`, like the system printer selection.
- Three wire protocols: continuous output (CAS/A&D style lines), Toledo 8217
  polled with `W`, and ECR-style polled with `ENQ`. Speed is 2400–19200 baud
  and the format is 8N1 or 7E1. Weights must be in kilograms or grams; a scale
  set to pounds is reported, never converted.
- A read resolves with the first stable weight within 2.5 s. Frames without a
  stability flag count once two in a row agree. Motion, overload, negative,
  empty pan, silence, a busy or missing port each return their own code, and the
  cashier can still type the weight.
- Admins and managers list ports, test a draft and save; only a port the OS
  enumerated can be saved or tested. Any signed-in role can read, and only from
  the saved selection, so the renderer never names a device path for a read.
- Reads on this computer run one at a time so two frames never interleave.

## Consequences

- A new native dependency rides with the desktop app; when its addon fails to
  load, the settings card says so and the register hides «Leer báscula».
- No server, schema or sync change: the reading fills the same weighed line as
  a typed weight.
- No scale model is qualified yet; physical validation follows the hardware
  qualification gate in `docs/HARDWARE-POS.md`.
