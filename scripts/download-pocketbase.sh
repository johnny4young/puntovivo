#!/bin/bash

# Download PocketBase binaries for all platforms
# Usage: ./download-pocketbase.sh [version]

set -e

VERSION="${1:-0.24.2}"
BASE_URL="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}"
RESOURCES_DIR="$(dirname "$0")/../apps/desktop/resources/pocketbase"

echo "Downloading PocketBase v${VERSION}..."

# Create directories
mkdir -p "${RESOURCES_DIR}/darwin_amd64"
mkdir -p "${RESOURCES_DIR}/darwin_arm64"
mkdir -p "${RESOURCES_DIR}/linux_amd64"
mkdir -p "${RESOURCES_DIR}/linux_arm64"
mkdir -p "${RESOURCES_DIR}/windows_amd64"

# Function to download and extract
download_and_extract() {
    local platform=$1
    local arch=$2
    local ext=$3
    local target_dir="${RESOURCES_DIR}/${platform}_${arch}"
    local filename="pocketbase_${VERSION}_${platform}_${arch}.${ext}"
    local url="${BASE_URL}/${filename}"
    
    echo "Downloading ${filename}..."
    
    if command -v curl &> /dev/null; then
        curl -L -o "/tmp/${filename}" "${url}"
    elif command -v wget &> /dev/null; then
        wget -O "/tmp/${filename}" "${url}"
    else
        echo "Error: Neither curl nor wget found"
        exit 1
    fi
    
    echo "Extracting to ${target_dir}..."
    unzip -o "/tmp/${filename}" -d "${target_dir}"
    rm "/tmp/${filename}"
    
    # Make executable on Unix systems
    if [[ "${ext}" == "zip" && "${platform}" != "windows" ]]; then
        chmod +x "${target_dir}/pocketbase"
    fi
    
    echo "✓ ${platform}_${arch} done"
}

# Download all platforms
download_and_extract "darwin" "amd64" "zip"
download_and_extract "darwin" "arm64" "zip"
download_and_extract "linux" "amd64" "zip"
download_and_extract "linux" "arm64" "zip"
download_and_extract "windows" "amd64" "zip"

echo ""
echo "All PocketBase binaries downloaded successfully!"
echo "Location: ${RESOURCES_DIR}"
