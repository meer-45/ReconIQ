// web/src/hooks/useLiveMatches.ts — React hook to subscribe to real-time live match notifications over WebSocket.

import { useEffect, useState, useRef, useCallback } from "react";

export interface LiveMatch {
  matchGroupId:         string;
  method:               string;
  transactionRecordIds: string[];
  confidence:           number;
  at:                   string;
}

export function useLiveMatches(onMatchReceived?: (match: LiveMatch) => void) {
  const [connected, setConnected] = useState<boolean>(false);
  const [latestMatch, setLatestMatch] = useState<LiveMatch | null>(null);
  const [matchCount, setMatchCount] = useState<number>(0);
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const callbackRef = useRef(onMatchReceived);

  useEffect(() => {
    callbackRef.current = onMatchReceived;
  }, [onMatchReceived]);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    // Connect to port 3000 backend or vite proxy
    const wsUrl = `${protocol}//${host}:3000/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        // Subscribe to live matches
        ws.send(JSON.stringify({ type: "subscribe", channel: "live_matches" }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "live_match" && data.payload) {
            const match: LiveMatch = data.payload;
            setLatestMatch(match);
            setMatchCount((c) => c + 1);
            setMatches((prev) => [match, ...prev.slice(0, 19)]);
            if (callbackRef.current) {
              callbackRef.current(match);
            }
          }
        } catch {
          /* ignore json parse errors */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Retry connection after 3s
        setTimeout(() => {
          if (wsRef.current === ws) {
            connect();
          }
        }, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (err) {
      console.warn("[WebSocket connect error]:", err);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    connected,
    latestMatch,
    matchCount,
    matches,
  };
}
