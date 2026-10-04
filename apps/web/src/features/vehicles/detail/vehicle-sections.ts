import { DOCUMENT_FOLDERS } from './vehicle-documents';
import { HISTORY_SECTIONS } from './vehicle-history';
import { FINANCE_SECTIONS, HARDWARE_SECTIONS } from './vehicle-money-hardware';

/**
 * Which of the vehicle page's tabs and sections a caller is offered.
 *
 * Thirteen sections live under six tabs. Built in one place, from the same
 * gates, so the tab strip and the header's "More sections" menu can never
 * offer a destination the other does not — and a tab whose every section is
 * gated away is not offered at all.
 */

export type VehicleTab = 'overview' | 'rc' | 'documents' | 'history' | 'finance' | 'hardware';

/** Where a tab, a section inside it, or a document folder opens. */
export interface VehicleDestination {
  tab: VehicleTab;
  section?: string;
  folder?: string;
}

export interface VehicleSectionAccess {
  canLookupRegistration: boolean;
  canSeeQr: boolean;
  canSeeLoans: boolean;
  canSeeToll: boolean;
  canSell: boolean;
  canSeeDevices: boolean;
  canSeeCameras: boolean;
}

export function vehicleTabs(access: VehicleSectionAccess): { value: VehicleTab; label: string }[] {
  return [
    { value: 'overview' as const, label: 'Overview' },
    ...(access.canLookupRegistration ? [{ value: 'rc' as const, label: 'Virtual RC' }] : []),
    { value: 'documents' as const, label: 'Documents' },
    { value: 'history' as const, label: 'History' },
    ...(access.canSeeLoans || access.canSeeToll || access.canSell
      ? [{ value: 'finance' as const, label: 'Finance' }]
      : []),
    ...(access.canSeeDevices || access.canSeeCameras
      ? [{ value: 'hardware' as const, label: 'Hardware' }]
      : []),
  ];
}

/** The header menu's shortcuts, each a section the strip also offers. */
export function vehicleShortcuts(
  access: VehicleSectionAccess,
): { label: string; to: VehicleDestination }[] {
  return [
    ...(access.canLookupRegistration
      ? [{ label: 'Virtual RC', to: { tab: 'rc' as const } }]
      : []),
    { label: 'Documents', to: { tab: 'documents' } },
    { label: 'Photos', to: { tab: 'documents', folder: DOCUMENT_FOLDERS.photos } },
    ...(access.canSeeQr
      ? [{ label: 'QR code', to: { tab: 'documents' as const, folder: DOCUMENT_FOLDERS.qr } }]
      : []),
    { label: 'Trips', to: { tab: 'history', section: HISTORY_SECTIONS.trips } },
    { label: 'Maintenance', to: { tab: 'history', section: HISTORY_SECTIONS.maintenance } },
    { label: 'Driver history', to: { tab: 'history', section: HISTORY_SECTIONS.drivers } },
    ...(access.canSeeLoans
      ? [{ label: 'Loan & finance', to: { tab: 'finance' as const, section: FINANCE_SECTIONS.loan } }]
      : []),
    ...(access.canSeeToll
      ? [{ label: 'FASTag', to: { tab: 'finance' as const, section: FINANCE_SECTIONS.fastag } }]
      : []),
    ...(access.canSeeDevices
      ? [{ label: 'Hardware', to: { tab: 'hardware' as const, section: HARDWARE_SECTIONS.devices } }]
      : []),
    ...(access.canSeeCameras
      ? [{ label: 'Cameras', to: { tab: 'hardware' as const, section: HARDWARE_SECTIONS.cameras } }]
      : []),
    ...(access.canSell
      ? [{ label: 'Sell this vehicle', to: { tab: 'finance' as const, section: FINANCE_SECTIONS.sell } }]
      : []),
  ];
}
