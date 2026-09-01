import * as React from 'react';
import { AlertTriangle, Loader2, VideoOff } from 'lucide-react';
import { api } from '@/lib/api-client';
import type { LiveViewResult } from '@/lib/api-types';
import { cn } from '@/lib/utils';

/**
 * How often an open player tells Saarthi it is still watching.
 *
 * Comfortably inside the server's grace period, so one dropped ping on a slow
 * connection does not end a session somebody is watching.
 */
const KEEPALIVE_INTERVAL_MS = 30_000;

/**
 * Watching a live camera, over WHEP.
 *
 * The receiving half of the same protocol the device publishes with. Like WHIP
 * it is one HTTP POST — an SDP offer out, an SDP answer back — which is why
 * this needs no library at all: the browser already has a complete WebRTC
 * implementation, and WHEP exists precisely so nobody has to ship a signalling
 * client to use it.
 *
 *     POST {gatewayUrl}   Content-Type: application/sdp   body = offer
 *       → 201 Created     Location: {resource}            body = answer
 *     DELETE {resource}   when the viewer navigates away
 *
 * Frames go gateway → browser directly. They never touch the Saarthi API, which
 * is the whole reason a four-camera truck is affordable to watch.
 *
 * ## Non-trickle, deliberately
 *
 * The offer is only sent once ICE gathering has finished. It costs a second at
 * start-up and works against every WHEP server, rather than only those that
 * implement the optional PATCH for trickled candidates.
 */

interface WhepPlayerProps {
  ticket: LiveViewResult;
  onEnded?: () => void;
  className?: string;
}

type PlayerState = 'connecting' | 'playing' | 'failed';

export function WhepPlayer({ ticket, onEnded, className }: WhepPlayerProps): React.ReactElement {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [state, setState] = React.useState<PlayerState>('connecting');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // A mock ticket points at a gateway that does not exist. Saying so is a
    // better answer than a spinner that never resolves.
    if (ticket.simulated || ticket.protocol === 'mock') {
      setState('failed');
      setError('This environment has no video gateway, so there is nothing to play.');
      return;
    }

    /*
     * Mixed content.
     *
     * A page served over HTTPS cannot open an http:// connection, and the
     * browser refuses it before any request leaves — surfacing as a bare
     * "Failed to fetch" that says nothing about the cause. It is a common
     * arrangement in development: the dashboard reached through a tunnel, which
     * is HTTPS, and the video gateway on the LAN, which is not.
     *
     * Caught here so the answer names the actual problem, because from the
     * network tab this is indistinguishable from the gateway being down.
     */
    if (
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      ticket.gatewayUrl.startsWith('http://')
    ) {
      setState('failed');
      setError(
        'This page is on HTTPS and the video gateway is on plain HTTP, so the browser will not connect to it. ' +
          'Open the dashboard on the same network as the gateway, or put the gateway behind HTTPS.',
      );
      return;
    }

    let cancelled = false;
    let connection: RTCPeerConnection | null = null;
    let resourceUrl: string | null = null;
    let keepAlive: number | null = null;

    const start = async (): Promise<void> => {
      try {
        connection = new RTCPeerConnection({
          iceServers: ticket.iceServers.map((server) => ({
            urls: server.urls,
            ...(server.username ? { username: server.username } : {}),
            ...(server.credential ? { credential: server.credential } : {}),
          })),
        });

        // Receive-only. This is a viewer; declaring it keeps the offer honest
        // and stops the browser asking for camera permission it does not need.
        connection.addTransceiver('video', { direction: 'recvonly' });
        connection.addTransceiver('audio', { direction: 'recvonly' });

        connection.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
          }
        };

        connection.onconnectionstatechange = () => {
          if (cancelled || !connection) return;

          if (connection.connectionState === 'connected') {
            setState('playing');

            /*
             * Tell Saarthi the view is still open, on a timer.
             *
             * A stream session is closed by the sweep once nothing has claimed
             * it recently. Without this the view would be cut off after one
             * ticket length, and — worse — the access log would record every
             * viewing as exactly that long however long somebody really watched.
             * That log is the accountability for pointing a camera at a driver,
             * so its durations have to be real.
             */
            if (keepAlive === null) {
              keepAlive = window.setInterval(() => {
                void api
                  .post(`/cameras/sessions/${ticket.sessionId}/keepalive`)
                  .catch(() => undefined);
              }, KEEPALIVE_INTERVAL_MS);
            }
          }

          if (
            connection.connectionState === 'failed' ||
            connection.connectionState === 'disconnected'
          ) {
            setState('failed');
            setError('The connection to the camera was lost.');
          }
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        await waitForIceGathering(connection);
        if (cancelled) return;

        /*
         * Bounded, because an unbounded one is indistinguishable from success.
         *
         * Without a timeout a request that never returns leaves the player on
         * "Connecting…" for ever, which reads as "nearly there" rather than
         * "broken" — and a gateway behind a tunnel or a captive portal can
         * absolutely hold a request open. Fifteen seconds is well past a real
         * negotiation and well short of a person's patience.
         */
        const response = await fetch(ticket.gatewayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sdp',
            Authorization: `Bearer ${ticket.token}`,
          },
          body: connection.localDescription?.sdp ?? offer.sdp ?? '',
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          throw new Error(
            response.status === 401 || response.status === 403
              ? 'Saarthi refused this viewing session. It may have expired — close and reopen the camera.'
              : `The video gateway returned ${response.status}.`,
          );
        }

        /*
         * A gateway must answer with SDP.
         *
         * Anything else means something between here and it replied instead —
         * most often a tunnel or proxy serving an interstitial page, which is
         * HTML with a 200 and would otherwise be handed to
         * `setRemoteDescription` to fail with a parse error naming nothing.
         */
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('text/html')) {
          throw new Error(
            'Something between the dashboard and the video gateway answered with a web page ' +
              'instead of a stream. If the gateway is behind a tunnel, open its URL once in a ' +
              'browser tab to clear the interstitial, then try again.',
          );
        }

        const answer = await response.text();
        if (cancelled) return;

        // Kept so the session can be closed properly on the way out, rather
        // than left for the gateway to time out.
        const location = response.headers.get('Location');
        resourceUrl = location ? new URL(location, ticket.gatewayUrl).toString() : null;

        await connection.setRemoteDescription({ type: 'answer', sdp: answer });
      } catch (caught) {
        if (cancelled) return;
        setState('failed');

        /*
         * Say which address failed.
         *
         * A bare "Failed to fetch" is what the browser gives for a blocked
         * request, a DNS failure, a refused connection and a CORS rejection
         * alike — four completely different problems. Naming the URL is the one
         * piece of information that separates them, and without it the only way
         * forward is the developer console.
         */
        const detail =
          caught instanceof Error
            ? caught.name === 'TimeoutError' || caught.name === 'AbortError'
              ? `The video gateway did not respond within 15 seconds (${ticket.gatewayUrl}).`
              : caught.message === 'Failed to fetch'
                ? `Could not reach the video gateway at ${ticket.gatewayUrl}. It may be unreachable from this browser, or refusing cross-origin requests.`
                : caught.message
            : 'The camera could not be opened.';

        setError(detail);
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (keepAlive !== null) window.clearInterval(keepAlive);
      if (resourceUrl) {
        // `keepalive` so the request survives the page navigating away, which
        // is the most common way somebody stops watching.
        void fetch(resourceUrl, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${ticket.token}` },
          keepalive: true,
        }).catch(() => undefined);
      }
      connection?.close();
      onEnded?.();
    };
    // Re-running on a new ticket is exactly right: a re-issued ticket is a new
    // session, and the old connection should be torn down.
  }, [ticket, onEnded]);

  return (
    <div className={cn('relative aspect-video w-full overflow-hidden rounded-lg bg-black', className)}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // Muted, and not merely as a default: browsers block autoplay with
        // sound, so an unmuted player would simply not start. A dispatcher who
        // wants audio can unmute the element.
        muted
        className="size-full object-contain"
      />

      {state !== 'playing' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4 text-center">
          {state === 'connecting' ? (
            <>
              <Loader2 className="size-6 animate-spin text-white/80" />
              <p className="text-sm text-white/80">Connecting to the camera…</p>
            </>
          ) : (
            <>
              {error ? (
                <AlertTriangle className="size-6 text-warning" />
              ) : (
                <VideoOff className="size-6 text-white/60" />
              )}
              <p className="max-w-sm text-sm text-white/80">{error ?? 'No video.'}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Wait until every ICE candidate is in the offer.
 *
 * Resolves early if gathering is already finished, and gives up after a few
 * seconds rather than hanging: a network where gathering never completes will
 * still usually work with the candidates found so far, and a viewer staring at
 * a spinner forever is the worse outcome.
 */
function waitForIceGathering(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(finish, 5_000);

    function finish(): void {
      window.clearTimeout(timeout);
      connection.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }

    function onChange(): void {
      if (connection.iceGatheringState === 'complete') finish();
    }

    connection.addEventListener('icegatheringstatechange', onChange);
  });
}
