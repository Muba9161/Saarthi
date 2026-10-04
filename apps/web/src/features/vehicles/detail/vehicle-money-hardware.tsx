import * as React from 'react';
import type { VehicleSummary } from '@/lib/mobility-types';
import { SectionHeader } from '@/components/common/page-header';
import { LoanPanel } from '@/features/loans/loan-panel';
import { VehicleFastagPanel } from '@/features/toll/fastag-panel';
import { SellVehiclePanel } from '@/features/resale/sell-vehicle-panel';
import { VehicleHardware } from '@/features/devices/vehicle-hardware';
import { CameraGrid } from '@/features/cameras/camera-grid';
import { SectionSwitch, type SwitchSection } from './section-switch';

/**
 * The Finance and Hardware tabs.
 *
 * Each section is the panel it always was, behind the gate it always had —
 * the page passes the gates in, so this module never decides who may see a
 * loan. A section the caller may not see is absent from the switch, and a tab
 * left with none is not offered at all (see `vehicle-sections.ts`).
 */

export const FINANCE_SECTIONS = { loan: 'loan', fastag: 'fastag', sell: 'sell' } as const;
export const HARDWARE_SECTIONS = { devices: 'devices', cameras: 'cameras' } as const;

interface SectionProps {
  vehicle: VehicleSummary;
  section: string | undefined;
  onSectionChange: (section: string) => void;
}

export function VehicleFinance({
  vehicle,
  section,
  onSectionChange,
  canSeeLoans,
  canSeeToll,
  canSell,
}: SectionProps & { canSeeLoans: boolean; canSeeToll: boolean; canSell: boolean }) {
  const sections: SwitchSection[] = [
    ...(canSeeLoans
      ? [
          {
            value: FINANCE_SECTIONS.loan,
            label: 'Loan & EMI',
            content: (
              <div className="space-y-4">
                <SectionHeader
                  title="Loan &amp; finance"
                  description="What is owed on this vehicle, when the next installment falls due, and the repayment history. VorldX Saarthi keeps the record and sends reminders; it does not move money."
                />
                {/* Loads its own data, so finance is never fetched for a caller who cannot see it. */}
                <LoanPanel vehicleId={vehicle.id} registrationNumber={vehicle.registrationNumber} />
              </div>
            ),
          },
        ]
      : []),
    ...(canSeeToll
      ? [
          {
            value: FINANCE_SECTIONS.fastag,
            label: 'FASTag',
            content: (
              <div className="space-y-4">
                <SectionHeader
                  title="FASTag"
                  description="The tag fitted to this vehicle, what it can still pay, and what it spends at the barrier."
                />
                <VehicleFastagPanel vehicleId={vehicle.id} />
              </div>
            ),
          },
        ]
      : []),
    ...(canSell
      ? [
          {
            value: FINANCE_SECTIONS.sell,
            label: 'Sell',
            content: (
              // Starts from the vehicle, so the odometer, make, model and year
              // are the ones Saarthi has been recording, not retyped from memory.
              <div className="space-y-4">
                <SectionHeader
                  title="Sell this vehicle"
                  description="List it on the VorldX Saarthi resale marketplace. Photos and a price are all that stand between a draft and a live advert."
                />
                <SellVehiclePanel
                  vehicleId={vehicle.id}
                  registrationNumber={vehicle.registrationNumber}
                  manufacturer={vehicle.manufacturer}
                  model={vehicle.model}
                  year={vehicle.year}
                  odometerKm={vehicle.odometerKm}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <SectionSwitch
      label="Finance sections"
      sections={sections}
      value={section}
      onValueChange={onSectionChange}
    />
  );
}

export function VehicleHardwareTab({
  vehicle,
  section,
  onSectionChange,
  canSeeDevices,
  canSeeCameras,
}: SectionProps & { canSeeDevices: boolean; canSeeCameras: boolean }) {
  const sections: SwitchSection[] = [
    ...(canSeeDevices
      ? [
          {
            value: HARDWARE_SECTIONS.devices,
            label: 'Devices',
            content: (
              <VehicleHardware
                vehicleId={vehicle.id}
                registrationNumber={vehicle.registrationNumber}
              />
            ),
          },
        ]
      : []),
    ...(canSeeCameras
      ? [
          {
            value: HARDWARE_SECTIONS.cameras,
            label: 'Cameras',
            content: (
              <div className="space-y-4">
                <SectionHeader
                  title="Cameras"
                  description="Channels on the recorder currently fitted to this vehicle. Opening a live view is recorded against your account."
                />
                <CameraGrid
                  vehicleId={vehicle.id}
                  registrationNumber={vehicle.registrationNumber}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <SectionSwitch
      label="Hardware sections"
      sections={sections}
      value={section}
      onValueChange={onSectionChange}
    />
  );
}
