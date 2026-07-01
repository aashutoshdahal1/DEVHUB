/**
 * logStream.js
 * Manages WebSocket connections and fans out log lines to subscribed clients.
 *
 * WebSocket URL:  ws://localhost:3001/ws/logs/:projectId/:serviceType
 *
 * On connection the client immediately receives the last LOG_BUFFER_SIZE
 * buffered lines as individual JSON messages, then live lines as they arrive.
 */

"use strict";

const { WebSocketServer } = require("ws");
const pm = require("../services/processManager");

// subscribers: Map<`${projectId}:${serviceType}`, Set<WebSocket>>
const subscribers = new Map();

/**
 * Broadcast a single log line to all clients subscribed to
 * (projectId, serviceType).
 *
 * @param {string} projectId
 * @param {string} serviceType  "frontend" | "backend"
 * @param {Object} logLine      { id, level, timestamp, message }
 */
function broadcast(projectId, serviceType, logLine) {
  const key = `${projectId}:${serviceType}`;
  const clients = subscribers.get(key);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify({ type: "log", ...logLine });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Attach to an existing HTTP server so REST and WS share one port.
 * Called from server.js after the HTTP server is created.
 *
 * @param {http.Server} httpServer
 */
function attach(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Let Express handle HTTP upgrades; hijack only /ws/logs/* paths
  httpServer.on("upgrade", (req, socket, head) => {
    const parsed = new URL(req.url, 'http://localhost');
    const match = parsed.pathname.match(
      /^\/ws\/logs\/([^/]+)\/([^/]+)$/
    );
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, match[1], match[2]);
    });
  });

  wss.on("connection", (ws, req, projectId, serviceType) => {
    const key = `${projectId}:${serviceType}`;

    // Register subscriber
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key).add(ws);

    // Send recent buffered lines immediately
    const buffer = pm.getLogBuffer(projectId, serviceType);
    for (const line of buffer) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "log", ...line }));
      }
    }

    // Send a "connected" handshake
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: "connected",
          projectId,
          serviceType,
          bufferedLines: buffer.length,
        })
      );
    }

    ws.on("close", () => {
      const set = subscribers.get(key);
      if (set) set.delete(ws);
    });

    ws.on("error", (err) => {
      console.error(`[WS] error for ${key}:`, err.message);
      const set = subscribers.get(key);
      if (set) set.delete(ws);
    });
  });

  console.log("[WS] Log stream server attached");
}

module.exports = { attach, broadcast };
