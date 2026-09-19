const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;

// Les salons sont gardés en mémoire.
// Exemple : rooms.get("ABC123") = ensemble des joueurs du salon.
const rooms = new Map();

const server = http.createServer((req, res) => {
  let filePath;

if (req.url === "/" || req.url.startsWith("/?") || req.url === "/index.html") {
    filePath = path.join(__dirname, "index.html");
  } else if (req.url.startsWith("/skins/")) {
    const fileName = path.basename(req.url);
    filePath = path.join(__dirname, "skins", fileName);
  } else {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("File not found");
      return;
    }

    let contentType = "text/html";

    if (filePath.endsWith(".png")) {
      contentType = "image/png";
    }

    res.writeHead(200, {
      "Content-Type": contentType
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, exceptWs = null) {
  for (const player of room.players) {
    if (player.ws !== exceptWs) {
      send(player.ws, data);
    }
  }
}

function removePlayer(ws) {
  const roomCode = ws.roomCode;

  if (!roomCode) {
    return;
  }

  const room = rooms.get(roomCode);

  if (!room) {
    return;
  }

  const player = room.players.find((p) => p.ws === ws);

  if (player) {
    room.players = room.players.filter((p) => p.ws !== ws);

    broadcast(room, {
      type: "player-left",
      id: player.id
    });
  }

  if (room.players.length === 0) {
    rooms.delete(roomCode);
  }
}

wss.on("connection", (ws) => {
  ws.id = Math.random().toString(36).substring(2, 10);

  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    // =========================
    // REJOINDRE UN SALON
    // =========================

    if (data.type === "join") {
      const roomCode = String(data.room || "").trim().toUpperCase();
      const nickname = String(data.nickname || "Joueur").trim().slice(0, 20);
      const skin = String(data.skin || "ChatCasque.png");

      if (!roomCode) {
        send(ws, {
          type: "error",
          message: "Code de salon invalide."
        });
        return;
      }

      let room = rooms.get(roomCode);

      if (!room) {
        room = {
          players: []
        };

        rooms.set(roomCode, room);
      }

      if (room.players.length >= MAX_PLAYERS) {
        send(ws, {
          type: "error",
          message: "Ce salon est déjà plein (4 joueurs maximum)."
        });
        return;
      }

      // Évite qu'une même connexion rejoigne deux fois.
      if (ws.roomCode) {
        return;
      }

      const player = {
        id: ws.id,
        ws,
        nickname,
        skin
      };

      ws.roomCode = roomCode;
      ws.nickname = nickname;
      ws.skin = skin;

      // On mémorise le joueur.
      room.players.push(player);

      // On donne au nouveau joueur la liste des joueurs déjà présents.
      send(ws, {
        type: "joined",
        id: player.id,
        room: roomCode,
        players: room.players
          .filter((p) => p.ws !== ws)
          .map((p) => ({
            id: p.id,
            nickname: p.nickname,
            skin: p.skin
          }))
      });

      // On prévient les autres joueurs.
      broadcast(
        room,
        {
          type: "player-joined",
          player: {
            id: player.id,
            nickname: player.nickname,
            skin: player.skin
          }
        },
        ws
      );

      return;
    }

    // =========================
    // SIGNAL WEBRTC
    // =========================

    if (data.type === "signal") {
      const roomCode = ws.roomCode;

      if (!roomCode) {
        return;
      }

      const room = rooms.get(roomCode);

      if (!room) {
        return;
      }

      const target = room.players.find(
        (player) => player.id === data.to
      );

      if (!target) {
        return;
      }

      send(target.ws, {
        type: "signal",
        from: ws.id,
        signal: data.signal
      });

      return;
    }
  });

  ws.on("close", () => {
    removePlayer(ws);
  });

  ws.on("error", () => {
    removePlayer(ws);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("=================================");
  console.log(" Chat Lobby est lancé !");
  console.log(` http://localhost:${PORT}`);
  console.log("=================================");
  console.log("");
});