import { DeviceProvider } from '@saarthi/shared';
import { logger } from '../../lib/logger';
import { FreematicsAdapter } from './freematics.adapter';
import { GenericTelemetryAdapter } from './generic.adapter';
import { PhoneDeviceAdapter } from './phone.adapter';
import type { DeviceAdapter } from './device.adapter';

/**
 * Device adapter registry.
 *
 * The gateway looks an adapter up by the provider recorded on the device, so
 * adding hardware support is: write an adapter, add one line here. Nothing else
 * in the application changes, and no caller ever branches on the provider.
 */
const ADAPTERS: DeviceAdapter[] = [
  new FreematicsAdapter(),
  // The Saarthi Device app. It gets its own adapter rather than reusing the
  // generic one because it is the only source that mixes measured and simulated
  // values in a single frame, and the generic shape has no way to say which is
  // which.
  new PhoneDeviceAdapter(),
  new GenericTelemetryAdapter(DeviceProvider.MOCK),
  new GenericTelemetryAdapter(DeviceProvider.GENERIC_GPS),
  new GenericTelemetryAdapter(DeviceProvider.GENERIC_OBD),
  new GenericTelemetryAdapter(DeviceProvider.GENERIC_CAN),
];

const BY_PROVIDER = new Map<DeviceProvider, DeviceAdapter>(
  ADAPTERS.map((adapter) => [adapter.provider, adapter]),
);

export function adapterFor(provider: DeviceProvider): DeviceAdapter | null {
  return BY_PROVIDER.get(provider) ?? null;
}

export function registeredProviders(): DeviceProvider[] {
  return [...BY_PROVIDER.keys()];
}

logger.info(
  { providers: [...BY_PROVIDER.keys()] },
  'Device adapters registered',
);

export * from './device.adapter';
