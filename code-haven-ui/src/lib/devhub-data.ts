export type ServiceStatus = "running" | "stopped" | "error" | "installing" | "starting";

export interface Service {
  name: "Frontend" | "Backend";
  /** Maps to the backend API type: "frontend" | "backend" */
  serviceType: "frontend" | "backend";
  status: ServiceStatus;
  port: number;
  startCommand: string;
  uptimeMinutes: number;
  logs: LogLine[];
}

export interface LogLine {
  id: string;
  level: "info" | "warn" | "error";
  timestamp: string;
  message: string;
}

export interface EnvVar {
  id: string;
  key: string;
  value: string;
}

export interface Project {
  id: string;
  name: string;
  type: "MERN" | "HTML" | "Other";
  path: string;
  envFilePath?: string;
  services: Service[];
  envVars: EnvVar[];
}

const ts = (mAgo: number) => {
  const d = new Date(Date.now() - mAgo * 60_000);
  return d.toTimeString().slice(0, 8);
};

export const initialProjects: Project[] = [
  {
    id: "p1",
    name: "acme-storefront",
    type: "MERN",
    path: "~/code/acme-storefront",
    envFilePath: ".env.local",
    services: [
      {
        name: "Frontend",
        serviceType: "frontend",
        status: "running",
        port: 5173,
        startCommand: "npm run dev",
        uptimeMinutes: 134,
        logs: [
          { id: "1", level: "info", timestamp: ts(2), message: "VITE v5.4.0  ready in 412 ms" },
          { id: "2", level: "info", timestamp: ts(2), message: "  ➜  Local:   http://localhost:5173/" },
          { id: "3", level: "info", timestamp: ts(1), message: "[HMR] page reload src/App.tsx" },
          { id: "4", level: "warn", timestamp: ts(1), message: "warning: Fast refresh only works when a file only exports components." },
          { id: "5", level: "info", timestamp: ts(0), message: "GET /api/products 200 14ms" },
        ],
      },
      {
        name: "Backend",
        serviceType: "backend",
        status: "running",
        port: 4000,
        startCommand: "npm run server",
        uptimeMinutes: 134,
        logs: [
          { id: "1", level: "info", timestamp: ts(5), message: "🚀 Server listening on port 4000" },
          { id: "2", level: "info", timestamp: ts(4), message: "MongoDB connected: cluster0.mongodb.net" },
          { id: "3", level: "info", timestamp: ts(2), message: "GET /api/products 200 8ms" },
          { id: "4", level: "info", timestamp: ts(1), message: "POST /api/cart 201 22ms" },
          { id: "5", level: "warn", timestamp: ts(0), message: "Slow query detected: products.find (340ms)" },
        ],
      },
    ],
    envVars: [
      { id: "1", key: "DATABASE_URL", value: "mongodb+srv://user:pass@cluster0.mongodb.net/acme" },
      { id: "2", key: "JWT_SECRET", value: "your-jwt-secret-here" },
      { id: "3", key: "STRIPE_KEY", value: "your-stripe-key-here" },
      { id: "4", key: "NODE_ENV", value: "development" },
    ],
  },
  {
    id: "p2",
    name: "portfolio-site",
    type: "HTML",
    path: "~/code/portfolio-site",
    services: [
      {
        name: "Frontend",
        serviceType: "frontend",
        status: "running",
        port: 8080,
        startCommand: "npx serve .",
        uptimeMinutes: 47,
        logs: [
          { id: "1", level: "info", timestamp: ts(47), message: "Serving!  -  Local: http://localhost:8080" },
          { id: "2", level: "info", timestamp: ts(10), message: "HTTP  GET /index.html 200" },
          { id: "3", level: "info", timestamp: ts(2), message: "HTTP  GET /style.css 200" },
        ],
      },
    ],
    envVars: [],
  },
  {
    id: "p3",
    name: "task-tracker-api",
    type: "MERN",
    path: "~/code/task-tracker",
    envFilePath: ".env",
    services: [
      {
        name: "Frontend",
        serviceType: "frontend",
        status: "stopped",
        port: 3000,
        startCommand: "npm start",
        uptimeMinutes: 0,
        logs: [{ id: "1", level: "info", timestamp: ts(0), message: "Process not running." }],
      },
      {
        name: "Backend",
        serviceType: "backend",
        status: "stopped",
        port: 5000,
        startCommand: "node server.js",
        uptimeMinutes: 0,
        logs: [{ id: "1", level: "info", timestamp: ts(0), message: "Process not running." }],
      },
    ],
    envVars: [
      { id: "1", key: "PORT", value: "5000" },
      { id: "2", key: "MONGO_URI", value: "mongodb://localhost:27017/tasks" },
    ],
  },
  {
    id: "p4",
    name: "blog-cms",
    type: "MERN",
    path: "~/code/blog-cms",
    envFilePath: ".env.local",
    services: [
      {
        name: "Frontend",
        serviceType: "frontend",
        status: "running",
        port: 5174,
        startCommand: "npm run dev",
        uptimeMinutes: 12,
        logs: [
          { id: "1", level: "info", timestamp: ts(12), message: "VITE ready in 380ms" },
          { id: "2", level: "info", timestamp: ts(1), message: "GET /api/posts 500 142ms" },
        ],
      },
      {
        name: "Backend",
        serviceType: "backend",
        status: "error",
        port: 4001,
        startCommand: "npm run server",
        uptimeMinutes: 0,
        logs: [
          { id: "1", level: "info", timestamp: ts(15), message: "Starting server..." },
          { id: "2", level: "error", timestamp: ts(15), message: "Error: listen EADDRINUSE: address already in use :::4001" },
          { id: "3", level: "error", timestamp: ts(15), message: "    at Server.setupListenHandle [as _listen2] (node:net:1740:16)" },
          { id: "4", level: "error", timestamp: ts(15), message: "    at listenInCluster (node:net:1788:12)" },
          { id: "5", level: "warn", timestamp: ts(15), message: "Process exited with code 1" },
        ],
      },
    ],
    envVars: [
      { id: "1", key: "DATABASE_URL", value: "postgres://localhost/blog" },
      { id: "2", key: "ADMIN_EMAIL", value: "admin@blog.dev" },
    ],
  },
];

export const formatUptime = (mins: number) => {
  if (mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
};
