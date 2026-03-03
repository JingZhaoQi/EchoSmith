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
pnpm run build
# Copy logo to dist
cp ../echo_logo.svg dist/
cd ..

# Step 3: Copy backend to tauri/src-tauri for bundling
echo -e "${YELLOW}[3/6] Preparing backend for bundling...${NC}"
rm -rf tauri/src-tauri/backend
cp -r tauri_backend_dist/backend tauri/src-tauri/

# Step 4: Build Tauri .app only (no DMG yet — we need to sign first)
echo -e "${YELLOW}[4/6] Building Tauri app bundle...${NC}"
cd tauri
npx tauri build --bundles app
cd ..

APP_PATH="tauri/src-tauri/target/release/bundle/macos/EchoSmith.app"
if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}Build failed: .app not found at $APP_PATH${NC}"
    exit 1
fi

# Step 5: Ad-hoc codesign all binaries (required for other Macs)
echo -e "${YELLOW}[5/6] Signing all binaries in app bundle...${NC}"
SIGN_COUNT=0

# Sign all .dylib files
while IFS= read -r -d '' f; do
    codesign --force -s - "$f" 2>/dev/null && SIGN_COUNT=$((SIGN_COUNT + 1))
done < <(find "$APP_PATH/Contents/Resources" -name "*.dylib" -print0)

# Sign all .so files
while IFS= read -r -d '' f; do
    codesign --force -s - "$f" 2>/dev/null && SIGN_COUNT=$((SIGN_COUNT + 1))
done < <(find "$APP_PATH/Contents/Resources" -name "*.so" -print0)

# Sign executable binaries in backend
for bin in \
    "$APP_PATH/Contents/Resources/backend/backend" \
    "$APP_PATH/Contents/Resources/backend/_internal/ffmpeg_bin/ffmpeg" \
    "$APP_PATH/Contents/Resources/backend/_internal/ffmpeg_bin/ffprobe"; do
    if [ -f "$bin" ]; then
        codesign --force -s - "$bin" 2>/dev/null && SIGN_COUNT=$((SIGN_COUNT + 1))
    fi
done

# Finally, sign the whole .app bundle (seals Resources into signature)
codesign --force --deep -s - "$APP_PATH"
SIGN_COUNT=$((SIGN_COUNT + 1))

echo "Signed $SIGN_COUNT binaries"

# Verify
if codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
    echo -e "${GREEN}Signature verification passed${NC}"
else
    echo -e "${YELLOW}Warning: Deep signature verification has issues (may still work)${NC}"
fi

# Step 6: Create DMG manually
echo -e "${YELLOW}[6/6] Creating DMG installer...${NC}"

FINAL_DMG="$ROOT_DIR/EchoSmith.dmg"
rm -f "$FINAL_DMG"

# Create a staging directory with the .app and an Applications symlink
DMG_STAGING=$(mktemp -d)
cp -r "$APP_PATH" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

hdiutil create \
    -volname "EchoSmith" \
    -srcfolder "$DMG_STAGING" \
    -ov \
    -format UDZO \
    "$FINAL_DMG"

rm -rf "$DMG_STAGING"

if [ ! -f "$FINAL_DMG" ]; then
    echo -e "${RED}Failed to create DMG${NC}"
    exit 1
fi

DMG_SIZE=$(du -h "$FINAL_DMG" | awk '{print $1}')
echo -e "${GREEN}Build complete!${NC}"
echo -e "${GREEN}DMG: $FINAL_DMG ($DMG_SIZE)${NC}"
