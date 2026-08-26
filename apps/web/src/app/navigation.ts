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
  BadgeCheck,
  BarChart3,
  Bell,
  Bot,
  Building2,
  FileCheck2,
  FileText,
  Fuel,
  Banknote,
  Receipt,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Package,
  PlayCircle,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
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
        label: 'Marketplace',
        to: '/marketplace',
        icon: Package,
        permissions: [Permission.ORDERS_QUOTE],
        feature: Feature.ORDERS_MARKETPLACE,
      },
    ],
  },
  {
    title: 'Fleet',
    items: [
      // No generalized "Vehicles" entry here: for a freight fleet every vehicle
      // is a truck, and two links to the same table under different names only
      // makes the operator wonder which one is authoritative. The passenger
      // view lives in MOBILITY_NAVIGATION, where it is the only view.
      { label: 'Trucks', to: '/fleet/trucks', icon: Truck, permissions: [Permission.TRUCKS_READ] },
      { label: 'Drivers', to: '/fleet/drivers', icon: Users, permissions: [Permission.DRIVERS_READ] },
      {
        label: 'Documents',
        to: '/fleet/documents',
        icon: FileText,
        permissions: [Permission.DOCUMENTS_READ],
        badgeKey: 'expiringDocuments',
      },
      {
        label: 'Vehicle registration',
        to: '/fleet/rc-lookup',
        icon: BadgeCheck,
        permissions: [Permission.VEHICLE_LOOKUP],
        feature: Feature.FLEET_BASIC,
      },
      {
        label: 'Maintenance',
        to: '/fleet/maintenance',
        icon: Wrench,
        permissions: [Permission.MAINTENANCE_READ],
        feature: Feature.MAINTENANCE_BASIC,
      },
      {
        label: 'Fuel',
        to: '/fleet/fuel',
        icon: Fuel,
        permissions: [Permission.FUEL_READ],
      },
      {
        label: 'Loans & EMI',
        to: '/fleet/loans',
        icon: Banknote,
        permissions: [Permission.LOANS_READ],
        feature: Feature.FINANCE_LOANS,
      },
      {
        label: 'Toll & FASTag',
        to: '/fleet/toll',
        icon: Receipt,
        permissions: [Permission.TOLL_READ],
        feature: Feature.TOLL_FASTAG,
      },
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
        label: 'Nearby services',
        to: '/nearby',
        icon: Activity,
        permissions: [Permission.NEARBY_READ],
        feature: Feature.NEARBY_SERVICES,
      },
    ],
  },
  {
    title: 'Connect',
    items: [
      {
        label: 'QR codes',
        to: '/qr',
        icon: QrCode,
        permissions: [Permission.QR_READ],
        feature: Feature.QR_IDENTITY,
      },
      {
        label: 'Telemetry alerts',
        to: '/telemetry/alerts',
        icon: Radio,
        permissions: [Permission.TELEMETRY_ALERTS_READ],
        feature: Feature.TELEMETRY_LIVE,
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
  {
    title: 'Demo',
    items: [
      {
        label: 'GPS simulator',
        to: '/simulator',
        icon: PlayCircle,
        permissions: [Permission.TRUCKS_UPDATE, Permission.ADMIN_SIMULATOR],
      },
    ],
  },
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
      {
        label: 'QR codes',
        to: '/qr',
        icon: QrCode,
        permissions: [Permission.QR_READ],
        feature: Feature.QR_IDENTITY,
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
      {
        label: 'Documents',
        to: '/fleet/documents',
        icon: FileText,
        permissions: [Permission.DOCUMENTS_READ],
        badgeKey: 'expiringDocuments',
      },
      {
        label: 'Vehicle registration',
        to: '/fleet/rc-lookup',
        icon: BadgeCheck,
        permissions: [Permission.VEHICLE_LOOKUP],
        feature: Feature.FLEET_BASIC,
      },
      {
        label: 'Maintenance',
        to: '/fleet/maintenance',
        icon: Wrench,
        permissions: [Permission.MAINTENANCE_READ],
        feature: Feature.MAINTENANCE_BASIC,
      },
      { label: 'Fuel', to: '/fleet/fuel', icon: Fuel, permissions: [Permission.FUEL_READ] },
      {
        label: 'Loans & EMI',
        to: '/fleet/loans',
        icon: Banknote,
        permissions: [Permission.LOANS_READ],
        feature: Feature.FINANCE_LOANS,
      },
      {
        label: 'Toll & FASTag',
        to: '/fleet/toll',
        icon: Receipt,
        permissions: [Permission.TOLL_READ],
        feature: Feature.TOLL_FASTAG,
      },
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
];

export const DRIVER_NAVIGATION: NavSection[] = [
  {
    title: 'Driving',
    items: [
      { label: 'My trip', to: '/driver', icon: Gauge, end: true },
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
  { label: 'My profile', to: '/settings/profile', icon: UserRoundCog },
  { label: 'Verification', to: '/verification', icon: ShieldCheck },
  { label: 'Settings', to: '/settings', icon: Settings },
];
