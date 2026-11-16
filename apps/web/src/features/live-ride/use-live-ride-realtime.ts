import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RideShareStatus, type PublicLiveRide, type RideTrailPoint } from '@saarthi/shared';
import { liveRideQueryKey, useLiveRide } from './live-ride-api';

const sameOriginWs = (): string =>
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

const WS_URL = (() => {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (!configured) return sameOriginWs();
  return configured.replace(/^http/, 'ws');
})();

interface RealtimeUpdateMessage {
  type: 'RIDE_SHARE_UPDATE';
  position: PublicLiveRide['position'];
  trail: RideTrailPoint[];
}

interface RealtimeSnapshotMessage {
  type: 'RIDE_SHARE_SNAPSHOT';
  ride: PublicLiveRide;
}

interface RealtimeEndedMessage {
  type: 'RIDE_SHARE_ENDED';
  summary?: PublicLiveRide['summary'];
  trail?: RideTrailPoint[];
}

interface RealtimeErrorMessage {
  type: 'ERROR';
  code: string;
  message: string;
}

type LiveRideWsMessage =
  | RealtimeUpdateMessage
  | RealtimeSnapshotMessage
  | RealtimeEndedMessage
  | RealtimeErrorMessage;

/**
 * Real-time WebSocket hook for following a live shared ride.
 *
 * Connects directly to `/ws/live?token=...` to receive sub-30ms coordinate pushes
 * and road trail updates, providing an Uber/Rapido-grade instant experience.
 * Automatically falls back to HTTP polling if WebSockets are unavailable or blocked.
 */
export function useLiveRideRealtime(token: string) {
  const queryClient = useQueryClient();
  const httpQuery = useLiveRide(token);
  const [realtimeConnected, setRealtimeConnected] = React.useState(false);
  const socketRef = React.useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = React.useRef<number | null>(null);
  const backoffRef = React.useRef(1_000);

  const queryKey = React.useMemo(() => liveRideQueryKey(token), [token]);

  React.useEffect(() => {
    if (!token) return undefined;

    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const wsUrl = `${WS_URL}/ws/live?token=${encodeURIComponent(token)}`;
      let socket: WebSocket;

      try {
        socket = new WebSocket(wsUrl);
      } catch {
        // Fallback to HTTP query
        setRealtimeConnected(false);
        return;
      }

      socketRef.current = socket;

      socket.onopen = () => {
        if (unmounted) return;
        setRealtimeConnected(true);
        backoffRef.current = 1_000;
      };

      socket.onmessage = (event) => {
        if (unmounted) return;
        try {
          const message = JSON.parse(event.data as string) as LiveRideWsMessage;

          if (message.type === 'RIDE_SHARE_SNAPSHOT') {
            queryClient.setQueryData(queryKey, message.ride);
          } else if (message.type === 'RIDE_SHARE_UPDATE') {
            queryClient.setQueryData<PublicLiveRide>(queryKey, (prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                position: message.position,
                trail: message.trail,
              };
            });
          } else if (message.type === 'RIDE_SHARE_ENDED') {
            queryClient.setQueryData<PublicLiveRide>(queryKey, (prev) => {
              if (!prev) return prev;
              const trail = message.trail ?? prev.trail ?? [];
              const summary = message.summary ?? prev.summary ?? null;
              return {
                ...prev,
                status: RideShareStatus.ENDED,
                position: null,
                endedAt: prev.endedAt ?? new Date().toISOString(),
                trail,
                summary,
              };
            });
            // Re-fetch in background to ensure perfect parity
            void httpQuery.refetch();
          }
        } catch {
          // Ignore unparseable frames
        }
      };

      socket.onclose = (event) => {
        if (unmounted) return;
        setRealtimeConnected(false);
        socketRef.current = null;

        // Reconnect if not cleanly closed or ride ended
        if (event.code !== 1000 && event.code !== 4404) {
          const delay = Math.min(15_000, backoffRef.current);
          backoffRef.current = Math.min(15_000, backoffRef.current * 1.5);
          reconnectTimeoutRef.current = window.setTimeout(connect, delay);
        }
      };

      socket.onerror = () => {
        // Handled by onclose
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.close(1000, 'unmounted');
        socketRef.current = null;
      }
    };
  }, [token, queryClient, queryKey]);

  return {
    ...httpQuery,
    isRealtime: realtimeConnected,
  };
}
