// Petit client pour l'API Home Assistant, accessible via le proxy Supervisor
// (nécessite homeassistant_api: true dans config.yaml pour obtenir SUPERVISOR_TOKEN).
const SUPERVISOR_API = "http://supervisor/core/api";

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function listMediaPlayers() {
  const res = await fetch(`${SUPERVISOR_API}/states`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`API HA /states a répondu ${res.status}`);
  const states = await res.json();
  return states
    .filter((s) => s.entity_id.startsWith("media_player."))
    .map((s) => ({
      entity_id: s.entity_id,
      name: (s.attributes && s.attributes.friendly_name) || s.entity_id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function callService(domain, service, data) {
  const res = await fetch(`${SUPERVISOR_API}/services/${domain}/${service}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Service HA ${domain}.${service} a échoué (${res.status}): ${text}`);
  }
}

async function turnOn(entityId) {
  await callService("media_player", "turn_on", { entity_id: entityId });
}

async function playMedia(entityId, mediaUrl, mediaType = "video") {
  await callService("media_player", "play_media", {
    entity_id: entityId,
    media_content_id: mediaUrl,
    media_content_type: mediaType,
  });
}

module.exports = { listMediaPlayers, turnOn, playMedia };