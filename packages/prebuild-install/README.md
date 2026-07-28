# Puntovivo prebuild installer compatibility fork

This private workspace package vendors the MIT-licensed `prebuild-install` 7.1.3
runtime used by `better-sqlite3-multiple-ciphers`. The upstream package is no
longer maintained, while Puntovivo still needs its GitHub prebuild download
protocol for Electron and Node ABI artifacts.

The fork raises the runtime floor to Node 24, uses current compatible dependency
floors, and replaces legacy `fs.R_OK` / `fs.W_OK` access with
`fs.constants.R_OK` / `fs.constants.W_OK`. Keep its CLI contract pinned through
the repository native-runtime and clean-install gates.
