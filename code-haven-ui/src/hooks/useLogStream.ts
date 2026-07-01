/**
 * useLogStream.ts
 * WebSocket hook that streams log lines from the DevHub backend.
 *
 * Opens  ws://localhost:3001/ws/logs/:projectId/:serviceType
 * - Replays buffered lines on connect
 * - Auto-reconnects with exponential backoff (max 30 s)
 * - Cleans up on unmount
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { WS_BASE } from "@/lib/api";

export interface LogLine {
  id: string;
  level: "info" | "warn" | "error";
  timestamp: string;
  message: string;
}

interface UseLogStreamReturn {
  logs: LogLine[];
  connected: boolean;
  clear: () => void;
}

const MAX_LINES = 500;
const BASE_DELAY = 1000;   // 1 s
const MAX_DELAY  = 30_000; // 30 s

export function useLogStream(
  projectId: string,
  serviceType: "frontend" | "backend"
): UseLogStreamReturn {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryDelay = useRef(BASE_DELAY);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const clear = useCallback(() => setLogs([]), []);

  const connect = useCallback(() => {
    if (unmounted.current) return;
    if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
      wsRef.current.close();
    }

    const url = `${WS_BASE}/ws/logs/${projectId}/${serviceType}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmounted.current) { ws.close(); return; }
      setConnected(true);
      retryDelay.current = BASE_DELAY; // reset backoff on success
    };

    ws.onmessage = (event) => {
      if (unmounted.current) return;
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "log") {
          const { type: _t, ...line } = msg;
          setLogs((prev) => {
            const next = [...prev, line as LogLine];
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
          });
        }
        // "connected" handshake: nothing extra needed
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (unmounted.current) return;
      setConnected(false);
      // Reconnect with backoff
      retryTimer.current = setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, MAX_DELAY);
        connect();
      }, retryDelay.current);
    };

    ws.onerror = () => {
      ws.close(); // triggers onclose → reconnect
    };
  }, [projectId, serviceType]);

  useEffect(() => {
    unmounted.current = false;
    // Clear logs and reconnect whenever project or service changes
    setLogs([]);
    setConnected(false);
    retryDelay.current = BASE_DELAY;
    
    // Small delay avoids React 18 Strict Mode double-mount creating & closing WS instantly
    const initialTimer = setTimeout(() => {
      connect();
    }, 50);

    return () => {
      unmounted.current = true;
      clearTimeout(initialTimer);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { logs, connected, clear };
}
