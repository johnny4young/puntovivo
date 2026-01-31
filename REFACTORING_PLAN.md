# Plan de Refactorización - Open Yojob

## Resumen Ejecutivo

Este plan detalla la reestructuración del proyecto Open Yojob para convertirlo en una aplicación de escritorio pura usando Electron Forge con PocketBase como backend embebido.

---

## 🎯 Objetivos

1. **Electron 40** (última estable: v40.1.0 con Chromium 144 y Node 24.11.1)
2. **Node.js 24** LTS (v24.13.0 - actual LTS)
3. **Electron Forge** con template Vite + TypeScript
4. **npm** como package manager (no pnpm)
5. **PocketBase embebido** como proceso en background (Go 1.23)
6. **Auto-actualización gratuita** via GitHub Releases + update-electron-app
7. **Eliminar**: Turbo, Docker, nginx, Python, pnpm

---

## 📊 Análisis de Estado Actual

### Problemas Identificados

| Componente      | Estado Actual         | Objetivo           | Problema                     |
| --------------- | --------------------- | ------------------ | ---------------------------- |
| Electron        | v28.1.0               | **v40.1.0**        | Muy desactualizado           |
| Node.js         | 18/20                 | **v24.13.0 LTS**   | Desactualizado               |
| Build Tool      | electron-vite + Turbo | **Electron Forge** | Complejidad innecesaria      |
| Package Manager | pnpm                  | **npm**            | Electron Forge usa npm       |
| Backend         | PocketBase externo    | **Embebido**       | Debería ser child process    |
| Docker/nginx    | Presente              | **Eliminar**       | Innecesario para app desktop |
| Go              | 1.21                  | **1.23**           | Actualizar                   |
| CI              | Fallando              | **Funcional**      | Configuración incorrecta     |

### Arquitectura Actual vs Propuesta

```
ACTUAL:                           PROPUESTA:
┌─────────────────────┐           ┌─────────────────────────────┐
│   Web App (Vite)    │           │      Electron App v40       │
├─────────────────────┤           │  ┌─────────────────────────┐│
│  Desktop (Electron) │           │  │     Main Process        ││
├─────────────────────┤           │  │  ┌───────────────────┐  ││
│  Backend (External) │    →      │  │  │ PocketBase (Go)   │  ││
├─────────────────────┤           │  │  │ SQLite embebido   │  ││
│  Docker/nginx       │           │  │  └───────────────────┘  ││
├─────────────────────┤           │  ├─────────────────────────┤│
│  Turbo + pnpm       │           │  │  Renderer (React 18)    ││
└─────────────────────┘           │  │  TanStack + Tailwind    ││
                                  │  └─────────────────────────┘│
                                  └─────────────────────────────┘
```

---

## 🔄 Iteraciones de Refinamiento

### Iteración 1: Verificación de Versiones ✅

- **Electron 40.1.0** - Versión estable actual (Chromium 144.0.7559.96)
- **Node.js 24.13.0** - LTS actual (enero 2026)
- `create-electron-app@latest` usa **npm** por defecto

### Iteración 2: Arquitectura Refinada

- PocketBase se ejecuta como **child process** desde Electron main
- IPC bridge seguro: Renderer ↔ Preload ↔ Main ↔ PocketBase
- Comunicación HTTP local (localhost:8090) para API
- SQLite dentro de userData para persistencia

### Iteración 3: Auto-Update Strategy (Gratuito)

- `update-electron-app` es **GRATUITO** para repos públicos de GitHub
- Usa update.electronjs.org como servidor proxy
- Squirrel.Windows/Squirrel.Mac para instalación silenciosa
- **Configurable**: flag para habilitar/deshabilitar auto-updates

### Iteración 4: CI/CD y Cleanup

- Single workflow para build + test + release
- GitHub Actions con matrix para Win/Mac/Linux
- Artifacts automáticos a GitHub Releases
- Eliminar Docker, nginx, Turbo, pnpm

---

## 📋 Plan de Trabajo para Agentes

### 🔹 AGENTE 1: Scaffold Electron Forge (Prioridad: ALTA)

**Tareas:**

1. Eliminar apps/desktop/ actual
2. Crear nuevo proyecto con: `npx create-electron-app@latest desktop --template=vite-typescript`
3. Configurar forge.config.ts con:
   - makers: squirrel (win), zip (mac), deb (linux)
   - publishers: github
4. Configurar auto-update con update-electron-app
5. Integrar React + Tailwind en renderer

**Archivos a crear/modificar:**

```
apps/desktop/
├── forge.config.ts
├── package.json
├── tsconfig.json
├── vite.main.config.ts
├── vite.preload.config.ts
├── vite.renderer.config.ts
└── src/
    ├── main/
    │   ├── index.ts          # Main process + PocketBase spawn
    │   └── pocketbase.ts     # PocketBase manager
    ├── preload/
    │   └── index.ts          # IPC bridge
    └── renderer/
        ├── index.html
        ├── App.tsx
        └── ...               # React components
```

---

### 🔹 AGENTE 2: PocketBase Integration (Prioridad: ALTA)

**Tareas:**

1. Crear módulo pocketbase.ts para spawn del binario
2. Implementar health check y graceful shutdown
3. Configurar IPC para operaciones CRUD
4. Manejar rutas de datos según plataforma (app.getPath('userData'))

**Código ejemplo - pocketbase.ts:**

```typescript
import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';

class PocketBaseManager {
  private process: ChildProcess | null = null;
  private port = 8090;

  async start(): Promise<void> {
    const pbPath = this.getPocketBasePath();
    const dataDir = path.join(app.getPath('userData'), 'pb_data');

    this.process = spawn(pbPath, ['serve', '--http', `127.0.0.1:${this.port}`, '--dir', dataDir]);

    await this.waitForReady();
  }

  async stop(): Promise<void> {
    this.process?.kill('SIGTERM');
  }

  private getPocketBasePath(): string {
    const platform = process.platform;
    const arch = process.arch;
    // Return path to bundled pocketbase binary
    return path.join(process.resourcesPath, 'pocketbase', `pocketbase-${platform}-${arch}`);
  }

  private async waitForReady(): Promise<void> {
    // Health check polling
  }
}

export const pocketbase = new PocketBaseManager();
```

---

### 🔹 AGENTE 3: Migración de UI (Prioridad: MEDIA)

**Tareas:**

1. Copiar componentes de apps/web/src/ al renderer
2. Adaptar imports y paths
3. Configurar API client para localhost:8090
4. Verificar que TanStack Table/Query funcionen

**Dependencias a instalar:**

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tanstack/react-table": "^8.11.0",
    "@tanstack/react-query": "^5.17.0",
    "zustand": "^4.4.7"
  }
}
```

---

### 🔹 AGENTE 4: CI/CD y Cleanup (Prioridad: MEDIA)

**Tareas:**

1. Eliminar archivos innecesarios:
   - docker-compose.yml
   - Dockerfile
   - docker/
   - .dockerignore
   - turbo.json
   - pnpm-workspace.yaml
   - pnpm-lock.yaml
   - apps/web/ (integrado en desktop)

2. Crear nuevo CI workflow:

```yaml
# .github/workflows/build.yml
name: Build & Release

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24' # Node.js 24 LTS
          cache: 'npm'

      - name: Install dependencies
        run: npm ci
        working-directory: apps/desktop

      - name: Build & Package
        run: npm run make
        working-directory: apps/desktop
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: desktop-${{ matrix.os }}
          path: apps/desktop/out/make/**/*

  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - name: Download all artifacts
        uses: actions/download-artifact@v4

      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: desktop-*/**/*
          generate_release_notes: true
```

---

### 🔹 AGENTE 5: Golang Backend (Prioridad: BAJA)

**Tareas:**

1. Actualizar go.mod a Go 1.23
2. Compilar PocketBase para cada plataforma
3. Crear script de build para binarios

**go.mod actualizado:**

```go
module github.com/johnny4young/open-yojob/backend

go 1.23

require (
    github.com/pocketbase/pocketbase v0.24.0
)
```

---

## 📁 Estructura Final del Proyecto

```
open_yojob/
├── .github/
│   └── workflows/
│       └── build.yml           # CI/CD unificado
├── apps/
│   └── desktop/                # Electron Forge app
│       ├── forge.config.ts
│       ├── package.json
│       ├── vite.*.config.ts
│       ├── resources/
│       │   └── pocketbase/     # Binarios PocketBase por plataforma
│       └── src/
│           ├── main/
│           ├── preload/
│           └── renderer/
├── backend/                    # Go source para PocketBase custom
│   ├── go.mod
│   ├── go.sum
│   └── cmd/server/main.go
├── scripts/
│   └── migration/              # Herramienta de migración (Go)
├── .gitignore
├── LICENSE
├── MIGRATION_PLAN.md
├── README.md
└── package.json                # Root (minimal, para scripts globales)
```

---

## ⏱️ Cronograma Sugerido

| Fase | Agente   | Duración | Dependencias       |
| ---- | -------- | -------- | ------------------ |
| 1    | Agente 1 | 2h       | Ninguna            |
| 2    | Agente 2 | 2h       | Agente 1           |
| 3    | Agente 3 | 3h       | Agente 1           |
| 4    | Agente 4 | 1h       | Agente 1, 2, 3     |
| 5    | Agente 5 | 1h       | Ninguna (paralelo) |

**Total estimado: 5-6 horas** (con ejecución paralela)

---

## 🔧 Comandos de Desarrollo (Post-Refactor)

```bash
# Desarrollo
cd apps/desktop && npm run start

# Build
cd apps/desktop && npm run make

# Publicar a GitHub
cd apps/desktop && npm run publish

# Migración de datos
cd scripts/migration && go run . migrate --source <db-path>
```

---

## ✅ Checklist de Validación

- [ ] `npm run start` inicia Electron 40 con PocketBase embebido
- [ ] Hot reload funciona en renderer (Vite HMR)
- [ ] PocketBase se cierra correctamente al cerrar la app
- [ ] Build genera instaladores para Win/Mac/Linux
- [ ] Auto-update funciona desde GitHub Releases (configurable)
- [ ] CI pasa en todas las plataformas con Node.js 24
- [ ] Sin referencias a Python, Docker, pnpm, Turbo, nginx

---

## 📝 Notas Importantes

1. **Electron 40.1.0** - Versión estable actual con Chromium 144 y Node 24.11.1
2. **Node.js 24.13.0 LTS** - Versión LTS actual (enero 2026)
3. **Go 1.23** - Última versión estable para compilar PocketBase
4. **PocketBase binario** - Debe incluirse en `resources/` para cada plataforma target
5. **Firma de código** - Requerida para auto-updates en macOS (Apple Developer Program)
6. **Auto-update configurable** - Flag de entorno para habilitar/deshabilitar

---

## ⚙️ Configuración de Auto-Update

El auto-update será **configurable** mediante variables de entorno:

```typescript
// main/auto-updater.ts
import { updateElectronApp } from 'update-electron-app';

const AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE !== 'false';

export function initAutoUpdater() {
  if (!AUTO_UPDATE_ENABLED) {
    console.log('Auto-update disabled via environment variable');
    return;
  }

  // Solo funciona con repos públicos de GitHub
  updateElectronApp({
    updateInterval: '1 hour',
    notifyUser: true,
    logger: console,
  });
}
```

**Variables de entorno:**

- `AUTO_UPDATE=false` - Deshabilita auto-updates
- `AUTO_UPDATE_INTERVAL=30 minutes` - Intervalo de verificación

---

## 🚀 Próximos Pasos

**Plan confirmado con:**

- ✅ Electron 40.1.0 (última estable)
- ✅ Node.js 24.13.0 LTS
- ✅ Go 1.23 para PocketBase
- ✅ Auto-update configurable

¿Deseas que ejecute los agentes en background para implementar este plan?
