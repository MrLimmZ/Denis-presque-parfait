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

# --- 1b. Compile le SCSS (le Dockerfile ne le fait pas, style.css est servi tel quel) ---
(cd denis_presque_parfait/server && npm run build:css)
echo "→ CSS compilé."

# --- 2. Commit + push ---
git add -A
git commit -m "Deploy v${NEW_VERSION}"
git push

echo "→ Push terminé."

# --- 3. Attend que GitHub Actions ait construit et publié l'image de cette version ---
# (config.yaml -> image: HA télécharge l'image préconstruite au lieu de rebuilder
# sur la box ; il ne faut donc pas lancer la mise à jour avant la fin du build.)
IMAGE="mrlimmz/denis-presque-parfait-aarch64"
COMMIT=$(git rev-parse HEAD)

if command -v gh >/dev/null 2>&1; then
  echo "→ Build de l'image sur GitHub Actions (quelques minutes)…"
  RUN_ID=""
  for _ in $(seq 1 30); do
    RUN_ID=$(gh run list --workflow build.yml --commit "$COMMIT" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
    [ -n "$RUN_ID" ] && break
    sleep 2
  done
  if [ -z "$RUN_ID" ]; then
    echo "❌ Aucun build GitHub trouvé pour ce commit. Vérifie l'onglet Actions du dépôt."
    exit 1
  fi
  if ! gh run watch "$RUN_ID" --exit-status --interval 10 >/dev/null; then
    echo "❌ Le build de l'image a échoué. Détails : gh run view $RUN_ID --log-failed"
    exit 1
  fi
  echo "→ Image v${NEW_VERSION} publiée."
else
  echo "⚠️  gh n'est pas installé : attends la fin du build dans l'onglet Actions avant de mettre à jour HA."
fi

# --- 4. Vérifie que HA pourra télécharger l'image (package GHCR public) ---
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:${IMAGE}:pull" | sed -nE 's/.*"token":"([^"]+)".*/\1/p')
STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" \
  "https://ghcr.io/v2/${IMAGE}/manifests/${NEW_VERSION}")
if [ "$STATUS" != "200" ]; then
  echo "⚠️  L'image n'est pas téléchargeable publiquement (HTTP ${STATUS})."
  echo "   Rends le package public (une seule fois) :"
  echo "   https://github.com/users/MrLimmZ/packages/container/denis-presque-parfait-aarch64/settings"
  echo "   → Danger Zone → Change visibility → Public, puis relance la mise à jour dans HA."
  exit 1
fi

# --- 5. Déclenche la mise à jour côté HA via SSH (si l'accès est ouvert) ---
if ssh -o ConnectTimeout=5 -p "${HA_PORT}" "root@${HA_HOST}" "ha store reload >/dev/null 2>&1; ha addons update ${ADDON_SLUG}"; then
  ssh -o ConnectTimeout=5 -p "${HA_PORT}" "root@${HA_HOST}" "ha addons restart ${ADDON_SLUG}"
  echo "✅ Déployé en v${NEW_VERSION}"
else
  echo "→ SSH indisponible : termine depuis Home Assistant"
  echo "   Paramètres → Modules complémentaires → Boutique → ⋮ → Rechercher des mises à jour → Mettre à jour."
  echo "✅ v${NEW_VERSION} prête à être installée (téléchargement rapide de l'image)."
fi
