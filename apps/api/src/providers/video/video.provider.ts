/**
 * Video provider abstraction.
 *
 * Video never passes through Saarthi's API or its database. What this interface
 * produces is a *ticket*: a short-lived, camera-scoped credential the browser
 * presents to a video gateway, which then negotiates the stream directly with
 * the recorder. Frames go device → gateway → browser, and Saarthi holds only
 * the record that someone watched.
 *
 * That shape is what makes a four-camera truck affordable. Routing four live
 * 4G video streams through an application server would cost more in bandwidth
 * than the telematics does in total.
 */

export interface StreamTicket {
  /** Where the browser connects. A gateway URL, never a device address. */
  gatewayUrl: string;
  /** Opaque credential the gateway validates. Single camera, single session. */
  token: string;
  /** How the client should connect. */
  protocol: 'webrtc' | 'hls' | 'mock';
  expiresAt: string;
  /** ICE servers for WebRTC, when the protocol needs them. */
  iceServers?: { urls: string; username?: string; credential?: string }[];
  /** Poster frame while the stream negotiates, when one is available. */
  posterUrl?: string | null;
  /** `true` when nothing real is on the other end of this ticket. */
  simulated: boolean;
}

export interface StreamRequest {
  cameraId: string;
  deviceIdentifier: string;
  channel: number;
  /** Session id, so the gateway's logs line up with Saarthi's. */
  sessionId: string;
  ttlSeconds: number;
}

/**
 * A credential for the *sending* side of a stream.
 *
 * The mirror of `StreamTicket`, and needed because a phone is the first source
 * Saarthi has that pushes video rather than being pulled from. A YC06 is
 * reached at its own address by a gateway that knows how to talk to it; a
 * handset behind carrier NAT cannot be reached at all, so it has to publish
 * outward. Both end up as WebRTC at the browser, and the dashboard cannot tell
 * which kind of device it is watching — which is the point.
 */
export interface PublishTicket {
  /** Where the device publishes. A gateway ingest URL, never another device. */
  ingestUrl: string;
  /** The session this ticket belongs to, echoed for the device's own logs. */
  sessionId?: string;
  /** Opaque credential the gateway validates. One camera, one session. */
  token: string;
  /** How the device should publish. */
  protocol: 'whip' | 'rtmp' | 'mock';
  expiresAt: string;
  iceServers?: { urls: string; username?: string; credential?: string }[];
  /** Hints the device should honour, so one phone cannot saturate an uplink. */
  constraints: {
    maxWidth: number;
    maxHeight: number;
    maxFrameRate: number;
    maxBitrateKbps: number;
  };
  /** `true` when nothing on the other end will actually receive the stream. */
  simulated: boolean;
}

export interface PublishRequest {
  cameraId: string;
  deviceIdentifier: string;
  channel: number;
  sessionId: string;
  ttlSeconds: number;
}

export interface RecordingClip {
  clipId: string;
  cameraId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  /** Thumbnail first: a dashboard must never load full-resolution footage. */
  thumbnailUrl: string | null;
  /** Signed, short-lived. Resolved only when someone opens the clip. */
  playbackUrl: string | null;
  sizeBytes: number | null;
  simulated: boolean;
}

export interface ClipQuery {
  cameraId: string;
  deviceIdentifier: string;
  channel: number;
  from: Date;
  to: Date;
  limit: number;
}

export interface VideoProvider {
  readonly name: string;
  /** Whether live viewing is possible on this environment at all. */
  readonly supportsLive: boolean;
  /** Whether stored footage can be listed and played back. */
  readonly supportsPlayback: boolean;
  /**
   * Whether a device may push a stream to this gateway.
   *
   * Separate from `supportsLive` because they are different capabilities. A
   * deployment can be able to *view* a recorder the gateway dials out to while
   * having nowhere for a phone to publish, and a device told otherwise would
   * open its camera, burn battery and mobile data, and send frames into
   * nothing.
   */
  readonly supportsPublishing: boolean;
  readonly unavailableReason: string;
  issueTicket(request: StreamRequest): Promise<StreamTicket>;
  /** Credential for a device that publishes its own stream. */
  issuePublishTicket(request: PublishRequest): Promise<PublishTicket>;
  listClips(query: ClipQuery): Promise<RecordingClip[]>;
}
