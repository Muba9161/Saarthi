import type { ComponentType } from 'react';
import {
  Activity,
  UserRoundCog,
  QrCode,
  CalendarDays,
  Siren,
  Radio,
  Plane,
  Cpu,
  Car,
  BarChart3,
  Bell,
  Bot,
  Building2,
  FileCheck2,
  FileText,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Package,
  Route,
  ScanLine,
  PackageCheck,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Gavel,
  ClipboardList,
  MonitorSmartphone,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';
import { Feature, Permission, type RoleName } from '@saarthi/shared';

/**
 * Navigation model.
 *
 * Each item declares what it needs — a permission, a plan feature, a role —
 * and the shell hides what the signed-in user cannot use. The API enforces the
 * same rules, so hiding here is a courtesy, never the security boundary.
 */
export interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  /** Any one of these permissions is enough. */
  permissions?: Permission[];
  feature?: Feature;
  roles?: RoleName[];
  /** Show a live count badge from this key of the nav-badge payload. */
  badgeKey?: 'sos' | 'verification' | 'notifications' | 'expiringDocuments';
  /** Match child routes too. */
  end?: boolean;
  /**
   * Other routes this one destination owns.
   *
   * One entry can stand for several screens — the running-cost roll-ups share
   * a tab strip rather than taking four rows in the sidebar. Without this the
   * entry would go unhighlighted on three of the four, because matching is
   * done against `to` alone.
   */
  alsoMatches?: string[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const FLEET_NAVIGATION: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Command centre', to: '/dashboard', icon: LayoutDashboard, end: true },
      {
        label: 'Live map',
        to: '/tracking',
        icon: MapPin,
        permissions: [Permission.TRACKING_READ],
        feature: Feature.TRACKING_LIVE,
      },
      {
        label: 'Trips',
        to: '/trips',
        icon: Route,
        permissions: [Permission.TRIPS_READ],
      },
      {
        label: 'Orders',
        to: '/orders',
        icon: ShoppingCart,
        permissions: [Permission.ORDERS_READ],
      },
      {
        // Customer demand across every category this fleet can serve.
        //
        // There is no separate "Marketplace" entry beside this one any more.
        // Both rendered a screen headed "Open requirements", and this is the
        // wider of the two: `/orders/marketplace` lists freight orders only,
        // while the board carries freight transport plus the transport leg of
        // material supply. Every role granted ORDERS_QUOTE also holds
        // REQUIREMENTS_BID, so nothing became unreachable - and `/marketplace`
        // is still routed for anything linking to it directly.
        label: 'Bid on work',
        to: '/requirements/board',
        icon: Gavel,
        permissions: [Permission.REQUIREMENTS_BID],
      },
    ],
  },
  {
    // The operational core: the two rosters, and the two questions asked about a
    // vehicle before it leaves the yard. Everything that is a fleet-wide total
    // of per-vehicle records - paperwork, diesel, EMIs, toll - moved to
    // "Documents & costs" below, so this section stays short enough to scan.
    title: 'Fleet',
    items: [
      // No generalized "Vehicles" entry here: for a freight fleet every vehicle
      // is a truck, and two links to the same table under different names only
      // makes the operator wonder which one is authoritative. The passenger
      // view lives in MOBILITY_NAVIGATION, where it is the only view.
      { label: 'Trucks', to: '/fleet/trucks', icon: Truck, permissions: [Permission.TRUCKS_READ] },
      {
        label: 'Drivers',
        to: '/fleet/drivers',
        icon: Users,
        permissions: [Permission.DRIVERS_READ],
      },
      {
        // Placed under Fleet rather than Safety: it is a roster decision made
        // several times a day, not an incident. It sits directly above
        // Maintenance because both are about whether a vehicle may go out.
        label: 'Terminal arrivals',
        to: '/fleet/terminal-approvals',
        icon: MonitorSmartphone,
        permissions: [Permission.TERMINAL_READ],
      },
      {
        label: 'Maintenance',
        to: '/fleet/maintenance',
        icon: Wrench,
        permissions: [Permission.MAINTENANCE_READ],
        feature: Feature.MAINTENANCE_BASIC,
      },
      {
        // One entry for four screens — documents, fuel, EMIs and toll — which
        // between them held four sidebar rows for records that are also on each
        // vehicle's own page. They remain four distinct screens behind a tab
        // strip (see `features/fleet/running-costs-tabs`), each on the URL it
        // always had; the menu simply stopped listing them separately.
        label: 'Documents & costs',
        to: '/fleet/documents',
        icon: FileText,
        permissions: [
          Permission.DOCUMENTS_READ,
          Permission.FUEL_READ,
          Permission.LOANS_READ,
          Permission.TOLL_READ,
        ],
        badgeKey: 'expiringDocuments',
        alsoMatches: ['/fleet/fuel', '/fleet/loans', '/fleet/toll'],
      },
      // No QR entry. A code is an attribute of one vehicle or one driver, and it
      // is now issued with them automatically and shown as a tab on their own
      // page — so a menu row pointing at a fleet-wide list of codes only asked
      // the operator to match registration numbers by eye. `/qr` still exists
      // as the register of every code, reached from a vehicle or driver.
      // There is deliberately no "Vehicle registration" entry. That screen is
      // nothing but `RcLookupPanel`, which every vehicle already carries on its
      // own Registration tab - the same arrangement as the driver licence
      // lookup, which lives on the driver's page and has never had a menu entry
      // of its own. `/fleet/rc-lookup` still exists for the one case a vehicle
      // page cannot serve, a plate that is not in the fleet at all, and is
      // reached from the button on the Trucks screen.
    ],
  },
  {
    // Everything that means something has gone wrong, or is about to. Telemetry
    // alerts belong here rather than in a section of their own: overspeed,
    // harsh braking and temperature are safety events, and an operator working
    // an SOS is the same person who works these.
    title: 'Safety',
    items: [
      {
        label: 'SOS incidents',
        to: '/sos',
        icon: LifeBuoy,
        permissions: [Permission.SOS_READ],
        badgeKey: 'sos',
      },
      {
        label: 'Telemetry alerts',
        to: '/telemetry/alerts',
        icon: Radio,
        permissions: [Permission.TELEMETRY_ALERTS_READ],
        feature: Feature.TELEMETRY_LIVE,
      },
      {
        label: 'Nearby services',
        to: '/nearby',
        icon: Activity,
        permissions: [Permission.NEARBY_READ],
        feature: Feature.NEARBY_SERVICES,
      },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      {
        label: 'Analytics',
        to: '/analytics',
        icon: BarChart3,
        permissions: [Permission.ANALYTICS_READ],
      },
      {
        label: 'AI Copilot',
        to: '/copilot',
        icon: Bot,
        permissions: [Permission.AI_USE],
        feature: Feature.AI_COPILOT,
      },
    ],
  },
  // No Demo section. It held one entry pointing at `/simulator`, which the
  // command centre already offers as a primary button under the same demo-mode
  // gate, so the menu was carrying a section heading and a row to repeat a
  // control the operator lands on anyway. The route is untouched.
];

export const SUPPLIER_NAVIGATION: NavSection[] = [
  {
    title: 'Business',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, end: true },
      {
        label: 'Materials',
        to: '/supplier/materials',
        icon: Package,
        permissions: [Permission.MATERIALS_MANAGE],
      },
      { label: 'Orders', to: '/orders', icon: ShoppingCart, permissions: [Permission.ORDERS_READ] },
      {
        // The demand side a supplier previously could not see at all: customers
        // asking for material, rather than customers finding a listing.
        label: 'Bid on work',
        to: '/requirements/board',
        icon: Gavel,
        permissions: [Permission.REQUIREMENTS_BID],
      },
      {
        label: 'Deliveries',
        to: '/trips',
        icon: Route,
        permissions: [Permission.TRIPS_READ],
      },
      {
        label: 'Documents',
        to: '/fleet/documents',
        icon: FileText,
        permissions: [Permission.DOCUMENTS_READ],
      },
    ],
  },
];

export const CUSTOMER_NAVIGATION: NavSection[] = [
  {
    title: 'Buying',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, end: true },
      {
        // First, and deliberately so. Stating a need is now the customer's main
        // way into Saarthi for every category — material, freight, a cab or a
        // tour — rather than browsing four different catalogues and hoping one
        // of them holds what they were after.
        label: 'My requirements',
        to: '/requirements',
        icon: ClipboardList,
        permissions: [Permission.REQUIREMENTS_READ],
      },
      {
        label: 'Find materials',
        to: '/browse',
        icon: Package,
        permissions: [Permission.MATERIALS_READ],
      },
      {
        label: 'My orders',
        to: '/orders',
        icon: ShoppingCart,
        permissions: [Permission.ORDERS_READ],
      },
      {
        label: 'Track deliveries',
        to: '/tracking',
        icon: MapPin,
        permissions: [Permission.TRACKING_READ],
      },
      {
        label: 'Find travel',
        to: '/travel',
        icon: Plane,
        permissions: [Permission.TRAVEL_BROWSE],
        feature: Feature.TRAVEL_BOOKINGS,
      },
      {
        label: 'My travel',
        to: '/travel/bookings',
        icon: CalendarDays,
        permissions: [Permission.BOOKINGS_READ],
        feature: Feature.TRAVEL_BOOKINGS,
      },
      {
        label: 'Documents',
        to: '/fleet/documents',
        icon: FileText,
        permissions: [Permission.DOCUMENTS_READ],
      },
    ],
  },
];

/**
 * Truck association navigation.
 *
 * Deliberately short. An association coordinates roadside assistance, so it has
 * an emergency queue, its own profile and nothing else — no fleet, no orders, no
 * telemetry. The permission grants make those unreachable anyway; this simply
 * does not offer them.
 */
export const ASSOCIATION_NAVIGATION: NavSection[] = [
  {
    title: 'Emergency network',
    items: [
      {
        label: 'Emergency desk',
        to: '/association',
        icon: Siren,
        permissions: [Permission.ASSOCIATION_ALERTS_READ],
        end: true,
      },
      {
        label: 'Nearby services',
        to: '/nearby',
        icon: Activity,
        permissions: [Permission.NEARBY_READ],
      },
    ],
  },
];

/**
 * Travel & tour operator navigation.
 *
 * Same operational spine as a fleet — vehicles, drivers, documents, live
 * map — but the commercial half is passenger journeys, not freight. There
 * is deliberately no Trucks, Orders or Marketplace here: a tours business
 * does not quote for loads, and offering it those screens would only
 * invite dead ends.
 */
export const MOBILITY_NAVIGATION: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Command centre', to: '/dashboard', icon: LayoutDashboard, end: true },
      {
        label: 'Live map',
        to: '/tracking',
        icon: MapPin,
        permissions: [Permission.TRACKING_READ],
        feature: Feature.TRACKING_LIVE,
      },
      {
        label: 'Trips',
        to: '/trips',
        icon: Route,
        permissions: [Permission.TRIPS_READ],
      },
    ],
  },
  {
    title: 'Travel',
    items: [
      {
        // Passenger demand, which until now an operator had no way to see: a
        // customer wanting a car to Ayodhya had to find a published package
        // rather than ask, so the operator only ever heard from the ones who
        // happened to match something already in the catalogue.
        label: 'Bid on work',
        to: '/requirements/board',
        icon: Gavel,
        permissions: [Permission.REQUIREMENTS_BID],
      },
      {
        label: 'Packages',
        to: '/travel/provider/packages',
        icon: Plane,
        permissions: [Permission.TRAVEL_PACKAGES_READ],
      },
      {
        label: 'Bookings',
        to: '/travel/provider/bookings',
        icon: CalendarDays,
        permissions: [Permission.BOOKINGS_READ],
      },
    ],
  },
  {
    // Same split as FLEET_NAVIGATION, and for the same reason: a taxi operator
    // reads this menu on a phone as often as at a desk.
    title: 'Fleet',
    items: [
      {
        label: 'Vehicles',
        to: '/fleet/vehicles',
        icon: Car,
        permissions: [Permission.VEHICLES_READ],
      },
      {
        label: 'Drivers',
        to: '/fleet/drivers',
        icon: Users,
        permissions: [Permission.DRIVERS_READ],
      },
      // No QR entry, for the reason given in FLEET_NAVIGATION: a passenger
      // checking the cab they were sent is answered by the vehicle's own code,
      // which now lives on the vehicle.
      {
        // Placed under Fleet rather than Safety: it is a roster decision made
        // several times a day, not an incident. It sits directly above
        // Maintenance because both are about whether a vehicle may go out.
        label: 'Terminal arrivals',
        to: '/fleet/terminal-approvals',
        icon: MonitorSmartphone,
        permissions: [Permission.TERMINAL_READ],
      },
      {
        label: 'Maintenance',
        to: '/fleet/maintenance',
        icon: Wrench,
        permissions: [Permission.MAINTENANCE_READ],
        feature: Feature.MAINTENANCE_BASIC,
      },
      {
        // One entry for four screens — documents, fuel, EMIs and toll — which
        // between them held four sidebar rows for records that are also on each
        // vehicle's own page. They remain four distinct screens behind a tab
        // strip (see `features/fleet/running-costs-tabs`), each on the URL it
        // always had; the menu simply stopped listing them separately.
        label: 'Documents & costs',
        to: '/fleet/documents',
        icon: FileText,
        permissions: [
          Permission.DOCUMENTS_READ,
          Permission.FUEL_READ,
          Permission.LOANS_READ,
          Permission.TOLL_READ,
        ],
        badgeKey: 'expiringDocuments',
        alsoMatches: ['/fleet/fuel', '/fleet/loans', '/fleet/toll'],
      },
      // No "Vehicle registration" entry, for the reason given in
      // FLEET_NAVIGATION: it duplicates the vehicle's own Registration tab. The
      // Vehicles screen carries the button for looking up an outside plate.
    ],
  },
  {
    title: 'Safety',
    items: [
      {
        label: 'SOS incidents',
        to: '/sos',
        icon: LifeBuoy,
        permissions: [Permission.SOS_READ],
        badgeKey: 'sos',
      },
      {
        // A travel operator fits the same telematics hardware and holds the same
        // grants to work its alerts, including telemetry.alerts.manage. It sits
        // under Safety for the same reason as in FLEET_NAVIGATION.
        label: 'Telemetry alerts',
        to: '/telemetry/alerts',
        icon: Radio,
        permissions: [Permission.TELEMETRY_ALERTS_READ],
        feature: Feature.TELEMETRY_LIVE,
      },
      {
        label: 'Nearby services',
        to: '/nearby',
        icon: Activity,
        permissions: [Permission.NEARBY_READ],
        feature: Feature.NEARBY_SERVICES,
      },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      {
        label: 'Analytics',
        to: '/analytics',
        icon: BarChart3,
        permissions: [Permission.ANALYTICS_READ],
      },
      {
        label: 'AI Copilot',
        to: '/copilot',
        icon: Bot,
        permissions: [Permission.AI_USE],
        feature: Feature.AI_COPILOT,
      },
    ],
  },
  // No Demo section, for the reason given in FLEET_NAVIGATION.
];

export const DRIVER_NAVIGATION: NavSection[] = [
  {
    title: 'Driving',
    items: [
      { label: 'My trip', to: '/driver', icon: Gauge, end: true },
      // Second, under the trip itself: signing on to a vehicle is the first
      // thing a driver does at the start of a shift and the thing they come
      // back to when a request is waiting on their arrival photo.
      {
        label: 'Scan a vehicle',
        to: '/driver/scan',
        icon: ScanLine,
        permissions: [Permission.TERMINAL_DRIVE],
      },
      { label: 'Nearby', to: '/driver/nearby', icon: MapPin },
      { label: 'My score', to: '/driver/score', icon: ShieldCheck },
      { label: 'Documents', to: '/driver/documents', icon: FileText },
      { label: 'Trip history', to: '/driver/trips', icon: Route },
      { label: 'My bookings', to: '/travel/bookings', icon: CalendarDays },
      { label: 'My QR badge', to: '/qr', icon: QrCode },
    ],
  },
];

export const ADMIN_NAVIGATION: NavSection[] = [
  {
    title: 'Platform',
    items: [
      {
        label: 'Overview',
        to: '/admin',
        icon: LayoutDashboard,
        permissions: [Permission.ADMIN_PLATFORM],
        end: true,
      },
      {
        label: 'Verification queue',
        to: '/admin/verification',
        icon: FileCheck2,
        permissions: [Permission.VERIFICATION_REVIEW],
        badgeKey: 'verification',
      },
      {
        label: 'Users',
        to: '/admin/users',
        icon: Users,
        permissions: [Permission.ADMIN_USERS],
      },
      {
        label: 'Organizations',
        to: '/admin/organizations',
        icon: Building2,
        permissions: [Permission.ADMIN_ORGANIZATIONS],
      },
      {
        label: 'Devices',
        to: '/devices',
        icon: Cpu,
        permissions: [Permission.DEVICES_READ],
      },
      {
        // Beneath Devices, because that is where somebody goes when they are
        // thinking about the tablets in the trucks.
        label: 'Terminal releases',
        to: '/admin/terminal-releases',
        icon: PackageCheck,
        permissions: [Permission.ADMIN_PLATFORM],
      },
      {
        label: 'Audit log',
        to: '/admin/audit',
        icon: ScrollText,
        permissions: [Permission.ADMIN_AUDIT],
      },
    ],
  },
];

export const ACCOUNT_NAVIGATION: NavItem[] = [
  { label: 'Notifications', to: '/notifications', icon: Bell, badgeKey: 'notifications' },
  // Every account type on every plan can complete its own profile, so this
  // carries no permission or feature requirement.
  //
  // This is also where account settings live. There is no separate Settings
  // destination: everything it held is either a profile section already, or
  // was moved onto this screen as a step of its own.
  { label: 'My profile', to: '/settings/profile', icon: UserRoundCog },
  // Business documents and the GST check. Shown to anyone who can read
  // documents; the page itself says so plainly when the account is not acting
  // for an organization, rather than being hidden and leaving people hunting.
  {
    label: 'Business documents',
    to: '/settings/business-documents',
    icon: Building2,
    permissions: [Permission.DOCUMENTS_READ],
  },
  { label: 'Verification', to: '/verification', icon: ShieldCheck },
];
