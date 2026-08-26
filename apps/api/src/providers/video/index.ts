import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { MockVideoProvider } from './mock-video.provider';
import type {
  ClipQuery,
  RecordingClip,
  StreamRequest,
  StreamTicket,
  VideoProvider,
} from './video.provider';

/**
 * Video provider factory.
 *
 * `none` is the honest default. Most deployments have no camera hardware, and
 * a provider that pretends otherwise produces a live-view button that fails
 * only once somebody urgently needs it — during an incident.
 */
class NoVideoProvider implements VideoProvider {
  readonly name = 'none';
  readonly supportsLive = false;
  readonly supportsPlayback = false;
  readonly unavailableReason =
    'No video gateway is configured on this environment, so live camera viewing is unavailable. ' +
    'Cameras can still be registered against a device so the fleet record is complete.';

  async issueTicket(_request: StreamRequest): Promise<StreamTicket> {
    throw errors.providerNotConfigured('video', this.unavailableReason);
  }

  async listClips(_query: ClipQuery): Promise<RecordingClip[]> {
    throw errors.providerNotConfigured('video', this.unavailableReason);
  }
}

function createVideoProvider(): VideoProvider {
  switch (config.video.provider) {
    case 'mock':
      if (config.isProduction) {
        throw new Error(
          'VIDEO_PROVIDER=mock is not permitted in production — a simulated camera feed must ' +
            'never appear where an operator expects a live one.',
        );
      }
      return new MockVideoProvider();
    case 'none':
    default:
      return new NoVideoProvider();
  }
}

export const videoProvider: VideoProvider = createVideoProvider();

logger.info(
  { provider: videoProvider.name, live: videoProvider.supportsLive },
  'Video provider ready',
);

export * from './video.provider';
