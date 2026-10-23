import {
  compassDirection,
  fuelOfferingText,
  stationFuelOffering,
  type PetrolFuelFilter,
  type PetrolStation,
} from '@saarthi/shared';
import type { DeviceLocation } from './use-device-location';

/**
 * The DOM markers and popup HTML the fleet map draws over the basemap.
 *
 * Plain functions over plain elements: MapLibre moves a marker's element
 * itself, so `FleetMap` builds each one once and repaints it in place on every
 * update — these are what it builds and paints with.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MapTruck {
  id: string;
  registrationNumber: string;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speedKph?: number | null;
  status: string;
  driverName?: string | null;
  tripReference?: string | null;
  stale?: boolean;
  simulated?: boolean;
}

export interface MapMarkerPoint {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  kind: 'origin' | 'destination' | 'place' | 'incident' | 'stop' | 'waypoint';
}

// ---------------------------------------------------------------------------
// Truck markers
// ---------------------------------------------------------------------------

const STATUS_COLOURS: Record<string, string> = {
  ON_TRIP: '#1d4ed8',
  LOADING: '#0284c7',
  UNLOADING: '#0284c7',
  AVAILABLE: '#15803d',
  ASSIGNED: '#0369a1',
  IDLE: '#64748b',
  OFFLINE: '#94a3b8',
  MAINTENANCE: '#b45309',
  EMERGENCY: '#b91c1c',
  SUSPENDED: '#b91c1c',
};

function truckColour(status: string, stale?: boolean): string {
  if (stale) return '#94a3b8';
  return STATUS_COLOURS[status] ?? '#334155';
}

export function buildTruckElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'saarthi-truck-marker';
  element.style.cursor = 'pointer';
  element.style.willChange = 'transform';
  element.innerHTML = `
    <div style="position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;">
      <div data-halo style="position:absolute;inset:0;border-radius:9999px;opacity:.28;"></div>
      <div data-body style="position:relative;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;border:2px solid #fff;box-shadow:0 2px 10px rgba(15,23,42,.42), 0 0 0 4px rgba(255,255,255,.28);">
        <svg data-arrow width="12" height="12" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <path d="M12 2 4.5 20l7.5-4 7.5 4z" />
        </svg>
      </div>
    </div>`;
  return element;
}

export function paintTruckElement(
  element: HTMLElement,
  truck: MapTruck,
  selected: boolean,
  /** MapLibre writes marker position into `transform`; smoothing it turns
   *  discrete fixes into gliding motion, but the same smoothing makes the
   *  marker lag the map while the camera itself is animating. */
  smoothMotion: boolean,
): void {
  const colour = truckColour(truck.status, truck.stale);
  const body = element.querySelector<HTMLElement>('[data-body]');
  const halo = element.querySelector<HTMLElement>('[data-halo]');
  const arrow = element.querySelector<SVGElement>('[data-arrow]');

  element.style.transition = smoothMotion ? 'transform 1.05s linear' : 'none';

  if (body) {
    body.style.background = colour;
    // The selected truck gets a heavier ring so it stays findable in a cluster.
    body.style.boxShadow = selected
      ? '0 2px 12px rgba(15,23,42,.5), 0 0 0 5px rgba(37,99,235,.45)'
      : '0 2px 10px rgba(15,23,42,.42), 0 0 0 4px rgba(255,255,255,.28)';
  }
  if (halo) {
    halo.style.background = colour;
    // Only a moving truck pulses, so the eye is drawn to live movement.
    halo.style.animation =
      (truck.speedKph ?? 0) > 3 && !truck.stale
        ? 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite'
        : 'none';
  }
  if (arrow) {
    arrow.style.opacity = (truck.speedKph ?? 0) > 3 ? '1' : '0.55';
  }
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[<>&"]/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[character] ?? character,
  );
}

export function popupHtml(truck: MapTruck): string {
  const rows: string[] = [];
  if (truck.driverName) rows.push(`<div>Driver: ${escapeHtml(truck.driverName)}</div>`);
  if (truck.tripReference) rows.push(`<div>Trip: ${escapeHtml(truck.tripReference)}</div>`);
  rows.push(
    `<div>${Math.round(truck.speedKph ?? 0)} km/h · ${compassDirection(truck.heading ?? 0)}</div>`,
  );
  if (truck.simulated) rows.push('<div style="color:#b45309">Simulated GPS</div>');
  if (truck.stale) rows.push('<div style="color:#b45309">Position is stale</div>');

  return `
    <div style="padding:10px 12px;font-size:12px;line-height:1.5;min-width:180px;">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${escapeHtml(
        truck.registrationNumber,
      )}</div>
      <div style="text-transform:capitalize;color:#64748b;margin-bottom:6px;">${escapeHtml(
        truck.status.replace(/_/g, ' ').toLowerCase(),
      )}</div>
      ${rows.join('')}
    </div>`;
}

export const POINT_COLOURS: Record<MapMarkerPoint['kind'], string> = {
  origin: '#15803d',
  destination: '#b91c1c',
  place: '#0f2a5b',
  incident: '#dc2626',
  stop: '#0284c7',
  waypoint: '#7c3aed',
};

// ---------------------------------------------------------------------------
// Petrol stations
// ---------------------------------------------------------------------------

export function buildStationElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.style.cursor = 'pointer';
  element.innerHTML = `
    <div data-body style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;border:2px solid #fff;background:#d97706;box-shadow:0 2px 6px rgba(15,23,42,.35);transition:transform .18s ease-out;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="3" y1="22" x2="15" y2="22" />
        <line x1="4" y1="9" x2="14" y2="9" />
        <path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" />
        <path d="M18 22V11a3 3 0 0 0-3-3" />
      </svg>
    </div>`;
  return element;
}

export function paintStationElement(element: HTMLElement, selected: boolean): void {
  const body = element.querySelector<HTMLElement>('[data-body]');
  if (!body) return;
  body.style.transform = selected ? 'scale(1.28)' : 'scale(1)';
  body.style.boxShadow = selected
    ? '0 3px 10px rgba(15,23,42,.45), 0 0 0 4px rgba(217,119,6,.35)'
    : '0 2px 6px rgba(15,23,42,.35)';
}

// ---------------------------------------------------------------------------
// The viewer's own position
// ---------------------------------------------------------------------------

/**
 * "You are here" marker.
 *
 * Deliberately unlike the truck markers: a blue dot with a white collar is the
 * convention every phone map uses for *your* position, and reusing it here means
 * a driver never has to work out which pin is them.
 */
export function buildLiveElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.style.willChange = 'transform';
  element.innerHTML = `
    <div style="position:relative;display:flex;align-items:center;justify-content:center;width:30px;height:30px;">
      <div data-pulse style="position:absolute;inset:0;border-radius:9999px;background:#2563eb;opacity:.22;"></div>
      <div data-cone style="position:absolute;top:-6px;left:50%;margin-left:-7px;width:14px;height:14px;clip-path:polygon(50% 0,100% 100%,0 100%);background:#2563eb;opacity:.85;"></div>
      <div style="position:relative;width:16px;height:16px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.45);"></div>
    </div>`;
  return element;
}

export function paintLiveElement(element: HTMLElement, position: DeviceLocation): void {
  const cone = element.querySelector<HTMLElement>('[data-cone]');
  const pulse = element.querySelector<HTMLElement>('[data-pulse]');

  // The heading cone is shown only when the device actually reports a course.
  // Pointing it at north by default would be a confident lie about direction.
  if (cone) cone.style.display = position.headingDegrees === null ? 'none' : 'block';
  if (pulse) {
    pulse.style.animation =
      (position.speedKph ?? 0) > 3 ? 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite' : 'none';
  }
}

/**
 * Station popup.
 *
 * Mirrors the honesty rule the domain model documents: the directory says which
 * fuels a station *sells* and publishes an area rate — it reports no tank level
 * or dispenser state, so nothing here may read as live availability.
 */
export function stationPopupHtml(station: PetrolStation): string {
  const row = (label: string, fuel: PetrolFuelFilter): string =>
    `<div style="display:flex;justify-content:space-between;gap:10px;">
       <span style="color:#64748b;">${label}</span>
       <span style="color:#475569;">${escapeHtml(
         fuelOfferingText(stationFuelOffering(station, fuel)),
       )}</span>
     </div>`;

  const place = [station.city, station.state].filter(Boolean).join(', ');

  return `
    <div style="padding:10px 12px;font-size:12px;line-height:1.55;min-width:210px;">
      ${
        station.company
          ? `<div style="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#b45309;">${escapeHtml(
              station.company,
            )}</div>`
          : ''
      }
      <div style="font-weight:600;font-size:13px;">${escapeHtml(station.name ?? 'Petrol station')}</div>
      <div style="color:#64748b;margin-bottom:6px;">${escapeHtml(station.address ?? place)}</div>
      ${row('Petrol', 'petrol')}
      ${row('Diesel', 'diesel')}
      ${row('CNG', 'cng')}
      ${
        station.timings
          ? `<div style="margin-top:6px;color:#64748b;">${escapeHtml(station.timings)}</div>`
          : ''
      }
      <div style="margin-top:6px;font-size:10px;color:#94a3b8;">Fuel types as listed by the directory. It publishes no current rate.</div>
    </div>`;
}
