import * as React from 'react';
import { RealtimeEvent, type ChannelMessage, type ServerMessage } from '@saarthi/shared';
import { getAccessToken } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';

/**
 * Realtime connection.
 *
 * One WebSocket per browser tab, shared by every component through context.
 * Reconnects with exponential backoff, re-subscribes to whatever channels are
 * currently mounted, and heartbeats so a dead connection is noticed quickly.
 */

type Listener = (message: ChannelMessage) => void;

interface RealtimeContextValue {
  connected: boolean;
  /** Subscribe to channels for as long as the returned cleanup is not called. */
  subscribe: (channels: string[]) => () => void;
  /** Listen for a specific event type. Returns a cleanup function. */
  on: (event: ChannelMessage['type'], listener: Listener) => () => void;
}

const RealtimeContext = React.createContext<RealtimeContextValue | null>(null);

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

const MAX_BACKOFF_MS = 20_000;
const HEARTBEAT_MS = 25_000;

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const [connected, setConnected] = React.useState(false);

  const socketRef = React.useRef<WebSocket | null>(null);
  const listenersRef = React.useRef(new Map<string, Set<Listener>>());
  // Reference-counted so two components watching the same truck do not
  // unsubscribe each other on unmount.
  const channelsRef = React.useRef(new Map<string, number>());
  const attemptRef = React.useRef(0);
  const reconnectRef = React.useRef<number | null>(null);
  const heartbeatRef = React.useRef<number | null>(null);

  const send = React.useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  const connect = React.useCallback(() => {
    const token = getAccessToken();
    if (!token || socketRef.current) return;

    const socket = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(token)}`);
    socketRef.current = socket;

    socket.onopen = () => {
      attemptRef.current = 0;
      setConnected(true);

      const channels = [...channelsRef.current.keys()];
      if (channels.length > 0) socket.send(JSON.stringify({ type: 'subscribe', channels }));

      heartbeatRef.current = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping', at: Date.now() }));
        }
      }, HEARTBEAT_MS);
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      // Control frames carry no channel payload.
      if (
        message.type === RealtimeEvent.CONNECTED ||
        message.type === RealtimeEvent.SUBSCRIBED ||
        message.type === RealtimeEvent.UNSUBSCRIBED ||
        message.type === RealtimeEvent.PONG ||
        message.type === RealtimeEvent.ERROR
      ) {
        return;
      }

      const listeners = listenersRef.current.get(message.type);
      if (!listeners) return;
      for (const listener of listeners) {
        try {
          listener(message);
        } catch (error) {
          console.error('Realtime listener failed', error);
        }
      }
    };

    const scheduleReconnect = (): void => {
      socketRef.current = null;
      setConnected(false);
      if (heartbeatRef.current) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      attemptRef.current += 1;
      const backoff = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attemptRef.current);
      reconnectRef.current = window.setTimeout(() => connect(), backoff);
    };

    socket.onclose = scheduleReconnect;
    socket.onerror = () => socket.close();
  }, []);

  React.useEffect(() => {
    if (status !== 'authenticated') return undefined;
    connect();

    return () => {
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      setConnected(false);
    };
  }, [status, connect]);

  const subscribe = React.useCallback(
    (channels: string[]) => {
      const fresh: string[] = [];
      for (const channel of channels) {
        const count = channelsRef.current.get(channel) ?? 0;
        channelsRef.current.set(channel, count + 1);
        if (count === 0) fresh.push(channel);
      }
      if (fresh.length > 0) send({ type: 'subscribe', channels: fresh });

      return () => {
        const stale: string[] = [];
        for (const channel of channels) {
          const count = (channelsRef.current.get(channel) ?? 1) - 1;
          if (count <= 0) {
            channelsRef.current.delete(channel);
            stale.push(channel);
          } else {
            channelsRef.current.set(channel, count);
          }
        }
        if (stale.length > 0) send({ type: 'unsubscribe', channels: stale });
      };
    },
    [send],
  );

  const on = React.useCallback((event: ChannelMessage['type'], listener: Listener) => {
    const existing = listenersRef.current.get(event) ?? new Set<Listener>();
    existing.add(listener);
    listenersRef.current.set(event, existing);

    return () => {
      const set = listenersRef.current.get(event);
      set?.delete(listener);
      if (set && set.size === 0) listenersRef.current.delete(event);
    };
  }, []);

  const value = React.useMemo(() => ({ connected, subscribe, on }), [connected, subscribe, on]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const context = React.useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used inside <RealtimeProvider>');
  return context;
}

/** Subscribe to channels for the lifetime of the calling component. */
export function useChannels(channels: string[]): void {
  const { subscribe } = useRealtime();
  const key = channels.filter(Boolean).sort().join('|');

  React.useEffect(() => {
    const list = key ? key.split('|') : [];
    if (list.length === 0) return undefined;
    return subscribe(list);
  }, [key, subscribe]);
}

/** Handle a realtime event type with an always-current callback. */
export function useRealtimeEvent<T extends ChannelMessage['type']>(
  event: T,
  handler: (message: Extract<ChannelMessage, { type: T }>) => void,
): void {
  const { on } = useRealtime();
  const handlerRef = React.useRef(handler);
  handlerRef.current = handler;

  React.useEffect(
    () =>
      on(event, (message) => {
        handlerRef.current(message as Extract<ChannelMessage, { type: T }>);
      }),
    [event, on],
  );
}
