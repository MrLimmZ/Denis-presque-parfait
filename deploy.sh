#!/bin/bash
set -e

CONFIG_FILE="denis_presque_parfait/config.yaml"
HA_HOST="homeassistant.local"
HA_PORT="22222"
ADDON_SLUG="denis_presque_parfait"   # slug du repo, sans "local_" cette fois

# --- 1. Bump automatique du patch de version (0.1.0 -> 0.1.1) ---
CURRENT_VERSION=$(grep '^version:' "$CONFIG_FILE" | sed -E 's/version: "([0-9]+\.[0-9]+\.[0-9]+)"/\1/')
MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3)
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"

sed -i.bak "s/version: \"$CURRENT_VERSION\"/version: \"$NEW_VERSION\"/" "$CONFIG_FILE"
rm -f "${CONFIG_FILE}.bak"

echo "→ Version bump: ${CURRENT_VERSION} → ${NEW_VERSION}"

# --- 2. Commit + push ---
git add -A
git commit -m "Deploy v${NEW_VERSION}"
git push

echo "→ Push terminé."

# --- 3. Déclenche le refresh + update côté HA via SSH ---
ssh -p "${HA_PORT}" "root@${HA_HOST}" "ha addons update ${ADDON_SLUG}"
ssh -p "${HA_PORT}" "root@${HA_HOST}" "ha addons restart ${ADDON_SLUG}"

echo "✅ Déployé en v${NEW_VERSION}"