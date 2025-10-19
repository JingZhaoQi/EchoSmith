#!/usr/bin/env bash
set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting local DMG build for macOS...${NC}"

# Get the root directory
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

# Step 1: Build backend
echo -e "${YELLOW}[1/6] Building backend executable...${NC}"
bash scripts/build_backend.sh

# Step 2: Build frontend
echo -e "${YELLOW}[2/6] Building frontend...${NC}"
cd frontend
npm run build
# Copy logo to dist
cp ../echo_logo.svg dist/
cd ..

# Step 3: Copy backend to tauri/src-tauri for bundling
echo -e "${YELLOW}[3/6] Preparing backend for bundling...${NC}"
rm -rf tauri/src-tauri/backend
mkdir -p tauri/src-tauri/backend
cp tauri_backend_dist/backend/backend tauri/src-tauri/backend/

# Step 4: Copy frontend dist to tauri directory
echo -e "${YELLOW}[4/6] Copying frontend to tauri directory...${NC}"
rm -rf tauri/dist
cp -r frontend/dist tauri/dist

# Step 5: Build Tauri app
echo -e "${YELLOW}[5/6] Building Tauri app...${NC}"
cd tauri
npm run build

# Step 6: Find and report DMG location
echo -e "${YELLOW}[6/6] Locating built DMG...${NC}"
DMG_FILE=$(ls -t src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1)

if [ -z "$DMG_FILE" ]; then
    echo -e "${RED}❌ Build failed: No DMG file found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build complete!${NC}"
echo -e "${GREEN}DMG location: $ROOT_DIR/tauri/$DMG_FILE${NC}"

# Optional: Copy to a more accessible location
FINAL_DMG="$ROOT_DIR/EchoSmith.dmg"
cp "$DMG_FILE" "$FINAL_DMG"
echo -e "${GREEN}Copied to: $FINAL_DMG${NC}"