const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const { getValue, setValue } = require("./db");

const PORT = process.env.PORT || 8080;
const STATE_KEY = "demo_value";

const app = express();
app.use(express.json());

if (process.env.NODE_ENV !== "production") {
  const livereload = require("livereload");
  const connectLivereload = require("connect-livereload");

  const lrServer = livereload.createServer();
  lrServer.watch(path.join(__dirname, "public"));

  app.use(connectLivereload());
}

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(payload);
  });
}

wss.on("connection", (ws) => {
  // À la connexion, on envoie l'état courant au nouveau client
  const current = getValue(STATE_KEY) || "";
  ws.send(JSON.stringify({ type: "value", value: current }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "update" && typeof msg.value === "string") {
      setValue(STATE_KEY, msg.value);
      // On rediffuse à TOUT LE MONDE (panel + visiteurs) la nouvelle valeur
      broadcast({ type: "value", value: msg.value });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Denis Presque Parfait - serveur lancé sur le port ${PORT}`);
});