import { randomBytes } from 'node:crypto';
import { config } from '../../config/env';
import type {
  ClipQuery,
  PublishRequest,
  PublishTicket,
  RecordingClip,
  StreamRequest,
  StreamTicket,
  VideoProvider,
} from './video.provider';

/**
 * Local video gateway stand-in.
 *
 * Issues real tickets against a gateway that does not exist, so the whole path
 * around live video — authorisation, session recording, expiry, the four-up
 * camera grid — can be built and tested without a recorder on a desk.
 *
 * Every ticket and clip is flagged `simulated: true`, and the UI shows that as
 * a badge on the tile. A demo that looks indistinguishable from live footage is
 * how somebody ends up making a decision about a driver from a placeholder.
 */
export class MockVideoProvider implements VideoProvider {
  readonly name = 'mock';
  readonly supportsLive = true;
  readonly supportsPlayback = true;
  readonly supportsPublishing = true;
  readonly unavailableReason = '';

  async issueTicket(request: StreamRequest): Promise<StreamTicket> {
    return {
      // Points at Saarthi's own origin: there is no gateway locally, and a URL
      // pointing somewhere real would be worse than one that plainly is not.
      gatewayUrl: `${config.server.apiUrl}/mock-video/${request.sessionId}`,
      token: randomBytes(24).toString('base64url'),
      protocol: 'mock',
      expiresAt: new Date(Date.now() + request.ttlSeconds * 1000).toISOString(),
      posterUrl: null,
      simulated: true,
    };
  }

  /**
   * A publisher credential for a gateway that does not exist.
   *
   * Lets the Android side be built and exercised end to end — permissions,
   * preview, encoder start, reconnect, the whole state machine — without an SFU
   * running anywhere. `simulated: true` travels with it so the app can say so
   * on screen rather than showing a stream indicator over nothing.
   */
  async issuePublishTicket(request: PublishRequest): Promise<PublishTicket> {
    return {
      ingestUrl: `${config.server.apiUrl}/mock-video/publish/${request.sessionId}`,
      sessionId: request.sessionId,
      token: randomBytes(24).toString('base64url'),
      protocol: 'mock',
      expiresAt: new Date(Date.now() + request.ttlSeconds * 1000).toISOString(),
      constraints: {
        maxWidth: 1280,
        maxHeight: 720,
        maxFrameRate: 15,
        maxBitrateKbps: 800,
      },
      simulated: true,
    };
  }

  async listClips(query: ClipQuery): Promise<RecordingClip[]> {
    // Deterministic from the camera and the window, so a demo is reproducible
    // across restarts and a test can assert on it.
    const clips: RecordingClip[] = [];
    const windowMs = query.to.getTime() - query.from.getTime();
    const count = Math.min(query.limit, 6);

    for (let index = 0; index < count; index += 1) {
      const startedAt = new Date(query.from.getTime() + (windowMs / (count + 1)) * (index + 1));
      const durationSeconds = 60;

      clips.push({
        clipId: `SIM-${query.cameraId.slice(0, 8)}-${index}`,
        cameraId: query.cameraId,
        startedAt: startedAt.toISOString(),
        endedAt: new Date(startedAt.getTime() + durationSeconds * 1000).toISOString(),
        durationSeconds,
        thumbnailUrl: null,
        playbackUrl: null,
        sizeBytes: 12 * 1024 * 1024,
        simulated: true,
      });
    }

    return clips;
  }
}
