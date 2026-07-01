/**
 * server.js — DevHub local server entry point
 *
 * Runs Express (REST) + ws (WebSocket) on a single HTTP server.
 * Default port: 3001  (override with PORT env var)
 *
 * REST base:  http://localhost:3001/api
 * WS logs:   ws://localhost:3001/ws/logs/:projectId/:serviceType
 */

"use strict";

const http = require("http");
const express = require("express");
const cors = require("cors");

const projectsRouter = require("./routes/projects");
const envRouter = require("./routes/env");
const detectRouter = require("./routes/detect");
const logStream = require("./ws/logStream");
const pm = require("./services/processManager");

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// Allow any localhost / 127.0.0.1 origin so the UI works regardless of
// which port Vite picks (5173, 8080, 4173, 3000, etc.)
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, Postman, same-origin SSR)
      if (!origin) return cb(null, true);
      const isLocal =
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (isLocal) return cb(null, true);
      cb(new Error(`CORS: origin not allowed — ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/projects", projectsRouter);
app.use("/api/detect", detectRouter);

// Env routes are nested under /api/projects/:id/env
// We re-mount with mergeParams so :id is available inside env.js
app.use("/api/projects/:id/env", (req, res, next) => {
  req.params.id = req.params.id; // ensure id propagates
  next();
}, envRouter);

// 404 catch-all for API
app.use("/api", (req, res) => {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
});

// ── HTTP server + WS attachment ───────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;
const httpServer = http.createServer(app);

// Wire broadcast from logStream → processManager
logStream.attach(httpServer);
pm.setBroadcast(logStream.broadcast);

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`\n🚀  DevHub server running at http://localhost:${PORT}`);
  console.log(`   REST  → http://localhost:${PORT}/api/projects`);
  console.log(`   WS    → ws://localhost:${PORT}/ws/logs/:projectId/:serviceType`);
  console.log(`   Health → http://localhost:${PORT}/health\n`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[server] Received ${signal} — stopping all processes…`);
  pm.stopAll();
  httpServer.close(() => {
    console.log("[server] HTTP server closed. Bye!");
    process.exit(0);
  });
  // Force-exit if close takes too long
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});
