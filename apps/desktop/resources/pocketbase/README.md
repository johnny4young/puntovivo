# PocketBase Binaries

This directory contains the PocketBase binaries for each supported platform.

## Directory Structure

```
pocketbase/
├── darwin_amd64/
│   └── pocketbase
├── darwin_arm64/
│   └── pocketbase
├── linux_amd64/
│   └── pocketbase
├── linux_arm64/
│   └── pocketbase
└── windows_amd64/
    └── pocketbase.exe
```

## Download Instructions

1. Go to [PocketBase Releases](https://github.com/pocketbase/pocketbase/releases)
2. Download the latest release for each platform:
   - `pocketbase_x.x.x_darwin_amd64.zip` (macOS Intel)
   - `pocketbase_x.x.x_darwin_arm64.zip` (macOS Apple Silicon)
   - `pocketbase_x.x.x_linux_amd64.zip` (Linux x64)
   - `pocketbase_x.x.x_linux_arm64.zip` (Linux ARM64)
   - `pocketbase_x.x.x_windows_amd64.zip` (Windows x64)
3. Extract the binary to the appropriate directory
4. Make sure the binary is executable (chmod +x on Unix systems)

## Build Script

You can also use the build script to automatically download all binaries:

```bash
cd scripts
./download-pocketbase.sh
```

## Version

Current required version: **0.24.x** or later
