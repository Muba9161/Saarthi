import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RideShareStatus, type PublicLiveRide, type RideShareLiveMessage } from '@saarthi/shared';
import { realtimeBase } from '@/lib/api-client';
import { extendTrail, liveRideQueryKey, useLiveRide } from './live-ride-api';

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 15_000;
/** Closes that are final: the ride ended, or the link names no ride. */
const FINAL_CLOSE_CODES = [1000, 4404];

function applyLiveMessage(ride: PublicLiveRide | undefined, message: RideShareLiveMessage) {
  if (message.type === 'RIDE_SHARE_SNAPSHOT') return message.ride;
  // Nothing read yet: the first read brings the whole ride anyway.
  if (!ride) return ride;
  if (message.type === 'RIDE_SHARE_UPDATE') {
    return { ...ride, position: message.position, trail: extendTrail(ride.trail, message.trail) };
  }
  return {
    ...ride,
    status: RideShareStatus.ENDED,
    endedAt: message.endedAt,
    position: null,
    trail: [],
    summary: message.summary,
  };
}

/**
 * The ride behind a live link, moved as it moves.
 *
 * The reads of [useLiveRide] stay as they are; a socket on `/ws/live` writes
 * each move into the same query between them. A browser or network that will
 * not hold a socket loses nothing but speed: the page still polls.
 */
export function useLiveRideRealtime(token: string) {
  const queryClient = useQueryClient();
  const ride = useLiveRide(token);

  React.useEffect(() => {
    if (!token) return undefined;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let retryIn = FIRST_RETRY_MS;
    let stopped = false;

    const connect = (): void => {
      socket = new WebSocket(`${realtimeBase()}/ws/live?token=${encodeURIComponent(token)}`);
      socket.onopen = () => {
        retryIn = FIRST_RETRY_MS;
      };
      socket.onmessage = (event) => {
        let message: RideShareLiveMessage;
        try {
          message = JSON.parse(String(event.data)) as RideShareLiveMessage;
        } catch {
          return; // Not ours to read; the next poll corrects anything missed.
        }
        queryClient.setQueryData<PublicLiveRide>(liveRideQueryKey(token), (held) =>
          applyLiveMessage(held, message),
        );
      };
      socket.onclose = (event) => {
        if (stopped || FINAL_CLOSE_CODES.includes(event.code)) return;
        retry = window.setTimeout(connect, retryIn);
        retryIn = Math.min(MAX_RETRY_MS, retryIn * 2);
      };
    };
    connect();

    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket?.close(1000, 'left the page');
    };
  }, [token, queryClient]);

  return ride;
}
