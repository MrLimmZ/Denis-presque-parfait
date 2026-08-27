// Construit l'URL du WebSocket de façon RELATIVE à la page courante.
// Important : sous Ingress HA, l'URL contient un préfixe dynamique
// (/api/hassio_ingress/<token>/...). On ne peut donc pas coder "/ws" en dur.
function buildWsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const basePath = location.pathname.replace(/\/[^/]*$/, "/"); // enlève index.html / panel.html
  return `${proto}//${location.host}${basePath}ws`;
}

function connectWS({ onValue, onOpen, onClose } = {}) {
  // Wrapper stable : la référence ne change jamais, même si la socket
  // interne est recréée lors d'une reconnexion automatique.
  const handle = {
    socket: null,
    send(data) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(data);
      }
    },
    get readyState() {
      return this.socket ? this.socket.readyState : WebSocket.CLOSED;
    },
  };

  function open() {
    const ws = new WebSocket(buildWsUrl());
    handle.socket = ws;

    ws.addEventListener("open", () => onOpen && onOpen());
    ws.addEventListener("close", () => {
      onClose && onClose();
      setTimeout(open, 2000); // reconnexion simple après 2s
    });
    ws.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "value" && onValue) onValue(data.value);
    });
  }

  open();
  return handle;
}
