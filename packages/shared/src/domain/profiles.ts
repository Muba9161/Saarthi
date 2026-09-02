/**
 * Profile builder.
 *
 * Identity data in Saarthi is spread across User, Organization, Driver,
 * Supplier, Customer and the provider/association profiles — because each of
 * those tables has a job, and merging them would have been the wrong fix. What
 * was missing was a single *view* over them that knows what a complete profile
 * looks like for a given account type.
 *
 * That view is a blueprint: data, not code. The same definition drives the API's
 * validation, the UI's rendering and the completion maths, so the three can
 * never disagree about what "80% complete" means.
 */

import { MediaPurpose, OrganizationType, RoleName } from './enums';
import { LANGUAGE_OPTIONS } from './languages';

/** Which blueprint a signed-in user gets. */
export const ProfileAudience = {
  DRIVER: 'DRIVER',
  FLEET: 'FLEET',
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
  ASSOCIATION: 'ASSOCIATION',
  MOBILITY: 'MOBILITY',
  PLATFORM: 'PLATFORM',
} as const;
export type ProfileAudience = (typeof ProfileAudience)[keyof typeof ProfileAudience];

/** Input control for a field. */
export const ProfileFieldKind = {
  TEXT: 'TEXT',
  TEXTAREA: 'TEXTAREA',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  SELECT: 'SELECT',
  MULTI_SELECT: 'MULTI_SELECT',
  BOOLEAN: 'BOOLEAN',
  ADDRESS: 'ADDRESS',
  GEO: 'GEO',
  IMAGE: 'IMAGE',
  TAGS: 'TAGS',
  URL: 'URL',
} as const;
export type ProfileFieldKind = (typeof ProfileFieldKind)[keyof typeof ProfileFieldKind];

/** Which table a field writes to. The service fans a section patch out by this. */
export const ProfileTarget = {
  USER: 'user',
  USER_PROFILE: 'userProfile',
  DRIVER: 'driver',
  ORGANIZATION: 'organization',
  ORGANIZATION_PROFILE: 'organizationProfile',
  SUPPLIER: 'supplier',
  CUSTOMER: 'customer',
  MEDIA: 'media',
} as const;
export type ProfileTarget = (typeof ProfileTarget)[keyof typeof ProfileTarget];

export interface ProfileFieldOption {
  value: string;
  label: string;
}

export interface ProfileField {
  key: string;
  label: string;
  kind: ProfileFieldKind;
  target: ProfileTarget;
  /** Column on the target table, or the media purpose for IMAGE fields. */
  column: string;
  required: boolean;
  help?: string;
  placeholder?: string;
  options?: ProfileFieldOption[];
  mediaPurpose?: MediaPurpose;
  maxLength?: number;
  min?: number;
  max?: number;
  /** Only writable by an organization administrator, not a plain member. */
  organizationScoped?: boolean;
}

export interface ProfileSection {
  key: string;
  title: string;
  description: string;
  /** Lucide icon name, resolved by the UI. */
  icon: string;
  /**
   * Contribution to the overall percentage. Verification-relevant sections carry
   * more weight so completing the profile moves the account toward VERIFIED
   * rather than being decorative.
   */
  weight: number;
  fields: ProfileField[];
}

// ---------------------------------------------------------------------------
// Reusable sections
// ---------------------------------------------------------------------------

const PHOTO_SECTION: ProfileSection = {
  key: 'photo',
  title: 'Photo & cover',
  description: 'How you appear across Saarthi.',
  icon: 'Image',
  weight: 10,
  fields: [
    {
      key: 'avatar',
      label: 'Profile photo',
      kind: ProfileFieldKind.IMAGE,
      target: ProfileTarget.MEDIA,
      column: 'AVATAR',
      mediaPurpose: MediaPurpose.AVATAR,
      required: true,
      help: 'A clear head-and-shoulders photo. Shown to fleets, customers and at checkpoints.',
    },
    {
      key: 'cover',
      label: 'Cover image',
      kind: ProfileFieldKind.IMAGE,
      target: ProfileTarget.MEDIA,
      column: 'COVER',
      mediaPurpose: MediaPurpose.COVER,
      required: false,
    },
  ],
};

const IDENTITY_SECTION: ProfileSection = {
  key: 'identity',
  title: 'Identity',
  description: 'Your name and how you describe yourself.',
  icon: 'User',
  weight: 12,
  fields: [
    {
      key: 'firstName',
      label: 'First name',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.USER,
      column: 'firstName',
      required: true,
      maxLength: 80,
    },
    {
      key: 'lastName',
      label: 'Last name',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.USER,
      column: 'lastName',
      required: true,
      maxLength: 80,
    },
    {
      key: 'headline',
      label: 'Headline',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.USER_PROFILE,
      column: 'headline',
      required: false,
      maxLength: 120,
      placeholder: 'Long-haul driver, 12 years, Bengaluru to Delhi corridor',
    },
    {
      key: 'bio',
      label: 'About',
      kind: ProfileFieldKind.TEXTAREA,
      target: ProfileTarget.USER_PROFILE,
      column: 'bio',
      required: false,
      maxLength: 1200,
    },
    {
      key: 'languages',
      label: 'Languages spoken',
      kind: ProfileFieldKind.TAGS,
      target: ProfileTarget.USER_PROFILE,
      column: 'languages',
      required: false,
      help: 'Used when matching drivers to passengers and to customers.',
    },
  ],
};

const CONTACT_SECTION: ProfileSection = {
  key: 'contact',
  title: 'Contact',
  description: 'How Saarthi and your counterparties reach you.',
  icon: 'Phone',
  weight: 12,
  fields: [
    {
      key: 'phone',
      label: 'Mobile number',
      kind: ProfileFieldKind.PHONE,
      target: ProfileTarget.USER,
      column: 'phone',
      required: true,
      help: 'Used for trip alerts and emergencies.',
    },
    {
      key: 'emergencyContactName',
      label: 'Emergency contact name',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.USER_PROFILE,
      column: 'emergencyContactName',
      required: false,
      maxLength: 120,
    },
    {
      key: 'emergencyContactPhone',
      label: 'Emergency contact number',
      kind: ProfileFieldKind.PHONE,
      target: ProfileTarget.USER_PROFILE,
      column: 'emergencyContactPhone',
      required: false,
    },
  ],
};

const ADDRESS_SECTION: ProfileSection = {
  key: 'address',
  title: 'Address',
  description: 'Where you are based.',
  icon: 'MapPin',
  weight: 8,
  fields: [
    {
      key: 'addressLine',
      label: 'Address',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.USER_PROFILE,
      column: 'addressLine',
      required: false,
      maxLength: 300,
    },
    {
      key: 'city',
      label: 'City',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.USER_PROFILE,
      column: 'city',
      required: true,
      maxLength: 120,
    },
    {
      key: 'state',
      label: 'State',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.USER_PROFILE,
      column: 'state',
      required: true,
      maxLength: 120,
    },
    {
      key: 'postalCode',
      label: 'PIN code',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.USER_PROFILE,
      column: 'postalCode',
      required: false,
      maxLength: 20,
    },
  ],
};

const PREFERENCES_SECTION: ProfileSection = {
  key: 'preferences',
  title: 'Preferences',
  description: 'Language, units and how Saarthi looks to you.',
  icon: 'Settings2',
  weight: 5,
  fields: [
    {
      key: 'locale',
      label: 'Language',
      kind: ProfileFieldKind.SELECT,
      target: ProfileTarget.USER_PROFILE,
      column: 'preferences.locale',
      required: false,
      help: 'Saarthi switches to this language everywhere it has a translation.',
      // The same catalogue the registration form offers, so the choice made on
      // the way in is the choice shown here rather than a shorter list that
      // cannot represent it.
      options: [...LANGUAGE_OPTIONS],
    },
    {
      key: 'theme',
      label: 'Theme',
      kind: ProfileFieldKind.SELECT,
      target: ProfileTarget.USER_PROFILE,
      column: 'preferences.theme',
      required: false,
      options: [
        { value: 'system', label: 'Match my device' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
    },
    {
      key: 'distanceUnit',
      label: 'Distance unit',
      kind: ProfileFieldKind.SELECT,
      target: ProfileTarget.USER_PROFILE,
      column: 'preferences.distanceUnit',
      required: false,
      options: [
        { value: 'km', label: 'Kilometres' },
        { value: 'mi', label: 'Miles' },
      ],
    },
  ],
};

const VISIBILITY_SECTION: ProfileSection = {
  key: 'visibility',
  title: 'Visibility',
  description: 'Who inside Saarthi can see your profile.',
  icon: 'Eye',
  weight: 4,
  fields: [
    {
      key: 'visibility',
      label: 'Profile visibility',
      kind: ProfileFieldKind.SELECT,
      target: ProfileTarget.USER_PROFILE,
      column: 'visibility',
      required: false,
      options: [
        { value: 'PRIVATE', label: 'Only me and my organization' },
        { value: 'PARTNERS', label: 'Organizations I work with' },
        { value: 'PLATFORM', label: 'Any Saarthi account' },
      ],
      help: 'Saarthi profiles are never visible outside the platform.',
    },
  ],
};

const DRIVER_LICENCE_SECTION: ProfileSection = {
  key: 'licence',
  title: 'Licence & experience',
  description: 'What you are licensed and experienced to drive.',
  icon: 'BadgeCheck',
  weight: 18,
  fields: [
    {
      key: 'licenseNumber',
      label: 'Licence number',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.DRIVER,
      column: 'licenseNumber',
      required: true,
      maxLength: 40,
    },
    {
      key: 'licenseClass',
      label: 'Licence class',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.DRIVER,
      column: 'licenseClass',
      required: true,
      maxLength: 40,
      placeholder: 'HMV / HTV / LMV',
    },
    {
      key: 'licenseExpiryDate',
      label: 'Licence expires',
      kind: ProfileFieldKind.DATE,
      target: ProfileTarget.DRIVER,
      column: 'licenseExpiryDate',
      required: true,
    },
    {
      key: 'experienceYears',
      label: 'Years of experience',
      kind: ProfileFieldKind.NUMBER,
      target: ProfileTarget.DRIVER,
      column: 'experienceYears',
      required: true,
      min: 0,
      max: 60,
    },
    {
      key: 'bloodGroup',
      label: 'Blood group',
      kind: ProfileFieldKind.SELECT,
      target: ProfileTarget.DRIVER,
      column: 'bloodGroup',
      required: false,
      help: 'Released only to responders during an emergency.',
      options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((value) => ({
        value,
        label: value,
      })),
    },
  ],
};

const BUSINESS_IDENTITY_SECTION: ProfileSection = {
  key: 'business',
  title: 'Business identity',
  description: 'How your business appears to counterparties.',
  icon: 'Building2',
  weight: 16,
  fields: [
    {
      key: 'logo',
      label: 'Logo',
      kind: ProfileFieldKind.IMAGE,
      target: ProfileTarget.MEDIA,
      column: 'LOGO',
      mediaPurpose: MediaPurpose.LOGO,
      required: true,
      organizationScoped: true,
    },
    {
      key: 'name',
      label: 'Business name',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.ORGANIZATION,
      column: 'name',
      required: true,
      maxLength: 200,
      organizationScoped: true,
    },
    {
      key: 'tagline',
      label: 'Tagline',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.ORGANIZATION_PROFILE,
      column: 'tagline',
      required: false,
      maxLength: 160,
      organizationScoped: true,
    },
    {
      key: 'about',
      label: 'About the business',
      kind: ProfileFieldKind.TEXTAREA,
      target: ProfileTarget.ORGANIZATION_PROFILE,
      column: 'about',
      required: false,
      maxLength: 2000,
      organizationScoped: true,
    },
    {
      key: 'registrationNumber',
      label: 'Registration number',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.ORGANIZATION,
      column: 'registrationNumber',
      required: true,
      maxLength: 60,
      organizationScoped: true,
    },
    {
      key: 'taxNumber',
      label: 'GSTIN',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.ORGANIZATION,
      column: 'taxNumber',
      required: false,
      maxLength: 40,
      organizationScoped: true,
    },
    {
      key: 'foundedYear',
      label: 'Year established',
      kind: ProfileFieldKind.NUMBER,
      target: ProfileTarget.ORGANIZATION_PROFILE,
      column: 'foundedYear',
      required: false,
      min: 1900,
      max: 2100,
      organizationScoped: true,
    },
    {
      key: 'website',
      label: 'Website',
      kind: ProfileFieldKind.URL,
      target: ProfileTarget.ORGANIZATION_PROFILE,
      column: 'website',
      required: false,
      maxLength: 300,
      organizationScoped: true,
    },
  ],
};

const BUSINESS_CONTACT_SECTION: ProfileSection = {
  key: 'businessContact',
  title: 'Business contact',
  description: 'Where operational and billing messages go.',
  icon: 'Mail',
  weight: 10,
  fields: [
    {
      key: 'email',
      label: 'Business email',
      kind: ProfileFieldKind.EMAIL,
      target: ProfileTarget.ORGANIZATION,
      column: 'email',
      required: true,
      organizationScoped: true,
    },
    {
      key: 'phone',
      label: 'Business phone',
      kind: ProfileFieldKind.PHONE,
      target: ProfileTarget.ORGANIZATION,
      column: 'phone',
      required: true,
      organizationScoped: true,
    },
    {
      key: 'supportPhone',
      label: 'Operations phone',
      kind: ProfileFieldKind.PHONE,
      target: ProfileTarget.ORGANIZATION_PROFILE,
      column: 'supportPhone',
      required: false,
      organizationScoped: true,
    },
    {
      key: 'billingEmail',
      label: 'Billing email',
      kind: ProfileFieldKind.EMAIL,
      target: ProfileTarget.ORGANIZATION_PROFILE,
      column: 'billingEmail',
      required: false,
      organizationScoped: true,
    },
  ],
};

const BUSINESS_ADDRESS_SECTION: ProfileSection = {
  key: 'businessAddress',
  title: 'Business address',
  description: 'Your registered and operating address.',
  icon: 'MapPin',
  weight: 10,
  fields: [
    {
      key: 'addressLine',
      label: 'Address',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.ORGANIZATION,
      column: 'addressLine',
      required: true,
      maxLength: 300,
      organizationScoped: true,
    },
    {
      key: 'city',
      label: 'City',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.ORGANIZATION,
      column: 'city',
      required: true,
      maxLength: 120,
      organizationScoped: true,
    },
    {
      key: 'state',
      label: 'State',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.ORGANIZATION,
      column: 'state',
      required: true,
      maxLength: 120,
      organizationScoped: true,
    },
    {
      key: 'postalCode',
      label: 'PIN code',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.ORGANIZATION,
      column: 'postalCode',
      required: false,
      maxLength: 20,
      organizationScoped: true,
    },
    {
      key: 'location',
      label: 'Map location',
      kind: ProfileFieldKind.GEO,
      target: ProfileTarget.ORGANIZATION,
      column: 'latitude,longitude',
      required: false,
      help: 'Pin your yard or office so nearby matching works.',
      organizationScoped: true,
    },
  ],
};

const SERVICE_AREAS_SECTION: ProfileSection = {
  key: 'serviceAreas',
  title: 'Service areas',
  description: 'Where you operate. Used by discovery and last-mile matching.',
  icon: 'Globe2',
  weight: 8,
  fields: [
    {
      key: 'serviceAreas',
      label: 'Cities and districts served',
      kind: ProfileFieldKind.TAGS,
      target: ProfileTarget.ORGANIZATION_PROFILE,
      column: 'serviceAreas',
      required: false,
      organizationScoped: true,
    },
    {
      key: 'specialities',
      label: 'Specialities',
      kind: ProfileFieldKind.TAGS,
      target: ProfileTarget.ORGANIZATION_PROFILE,
      column: 'specialities',
      required: false,
      placeholder: 'Bulk cement, ODC, refrigerated',
      organizationScoped: true,
    },
    {
      key: 'certifications',
      label: 'Certifications',
      kind: ProfileFieldKind.TAGS,
      target: ProfileTarget.ORGANIZATION_PROFILE,
      column: 'certifications',
      required: false,
      organizationScoped: true,
    },
  ],
};

const SUPPLIER_YARD_SECTION: ProfileSection = {
  key: 'supplierYard',
  title: 'Yard & dispatch',
  description: 'Where material is dispatched from.',
  icon: 'Warehouse',
  weight: 12,
  fields: [
    {
      key: 'businessDescription',
      label: 'What you supply',
      kind: ProfileFieldKind.TEXTAREA,
      target: ProfileTarget.SUPPLIER,
      column: 'businessDescription',
      required: true,
      maxLength: 1200,
      organizationScoped: true,
    },
    {
      key: 'contactName',
      label: 'Yard contact name',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.SUPPLIER,
      column: 'contactName',
      required: true,
      maxLength: 120,
      organizationScoped: true,
    },
    {
      key: 'contactPhone',
      label: 'Yard contact phone',
      kind: ProfileFieldKind.PHONE,
      target: ProfileTarget.SUPPLIER,
      column: 'contactPhone',
      required: true,
      organizationScoped: true,
    },
    {
      key: 'addressLine',
      label: 'Yard address',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.SUPPLIER,
      column: 'addressLine',
      required: true,
      maxLength: 300,
      organizationScoped: true,
    },
    {
      key: 'location',
      label: 'Yard location',
      kind: ProfileFieldKind.GEO,
      target: ProfileTarget.SUPPLIER,
      column: 'latitude,longitude',
      required: true,
      help: 'Trucks are routed to this point for pickup.',
      organizationScoped: true,
    },
  ],
};

const CUSTOMER_DELIVERY_SECTION: ProfileSection = {
  key: 'customerDelivery',
  title: 'Delivery details',
  description: 'Where and how you take delivery.',
  icon: 'PackageCheck',
  weight: 12,
  fields: [
    {
      key: 'businessType',
      label: 'Business type',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.CUSTOMER,
      column: 'businessType',
      required: true,
      maxLength: 120,
      placeholder: 'Builder, contractor, trader',
      organizationScoped: true,
    },
    {
      key: 'addressLine',
      label: 'Default delivery address',
      kind: ProfileFieldKind.TEXT,
      target: ProfileTarget.CUSTOMER,
      column: 'addressLine',
      required: true,
      maxLength: 300,
      organizationScoped: true,
    },
    {
      key: 'location',
      label: 'Delivery location',
      kind: ProfileFieldKind.GEO,
      target: ProfileTarget.CUSTOMER,
      column: 'latitude,longitude',
      required: true,
      help: 'Saarthi checks this against city access rules before dispatch.',
      organizationScoped: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------

export const PROFILE_BLUEPRINTS: Record<ProfileAudience, ProfileSection[]> = {
  [ProfileAudience.DRIVER]: [
    PHOTO_SECTION,
    IDENTITY_SECTION,
    DRIVER_LICENCE_SECTION,
    CONTACT_SECTION,
    ADDRESS_SECTION,
    PREFERENCES_SECTION,
    VISIBILITY_SECTION,
  ],
  [ProfileAudience.FLEET]: [
    PHOTO_SECTION,
    IDENTITY_SECTION,
    CONTACT_SECTION,
    BUSINESS_IDENTITY_SECTION,
    BUSINESS_CONTACT_SECTION,
    BUSINESS_ADDRESS_SECTION,
    SERVICE_AREAS_SECTION,
    PREFERENCES_SECTION,
    VISIBILITY_SECTION,
  ],
  [ProfileAudience.SUPPLIER]: [
    PHOTO_SECTION,
    IDENTITY_SECTION,
    CONTACT_SECTION,
    BUSINESS_IDENTITY_SECTION,
    BUSINESS_CONTACT_SECTION,
    SUPPLIER_YARD_SECTION,
    SERVICE_AREAS_SECTION,
    PREFERENCES_SECTION,
    VISIBILITY_SECTION,
  ],
  [ProfileAudience.CUSTOMER]: [
    PHOTO_SECTION,
    IDENTITY_SECTION,
    CONTACT_SECTION,
    BUSINESS_IDENTITY_SECTION,
    BUSINESS_CONTACT_SECTION,
    CUSTOMER_DELIVERY_SECTION,
    PREFERENCES_SECTION,
    VISIBILITY_SECTION,
  ],
  [ProfileAudience.ASSOCIATION]: [
    PHOTO_SECTION,
    IDENTITY_SECTION,
    CONTACT_SECTION,
    BUSINESS_IDENTITY_SECTION,
    BUSINESS_CONTACT_SECTION,
    BUSINESS_ADDRESS_SECTION,
    SERVICE_AREAS_SECTION,
    PREFERENCES_SECTION,
    VISIBILITY_SECTION,
  ],
  [ProfileAudience.MOBILITY]: [
    PHOTO_SECTION,
    IDENTITY_SECTION,
    CONTACT_SECTION,
    BUSINESS_IDENTITY_SECTION,
    BUSINESS_CONTACT_SECTION,
    BUSINESS_ADDRESS_SECTION,
    SERVICE_AREAS_SECTION,
    PREFERENCES_SECTION,
    VISIBILITY_SECTION,
  ],
  [ProfileAudience.PLATFORM]: [
    PHOTO_SECTION,
    IDENTITY_SECTION,
    CONTACT_SECTION,
    PREFERENCES_SECTION,
  ],
};

/**
 * Which blueprint applies.
 *
 * Role wins over organization type: a driver inside a fleet organization gets
 * the driver blueprint, because the fields they can actually fill are theirs,
 * not the fleet's.
 */
export function resolveProfileAudience(input: {
  roles: readonly RoleName[];
  membershipRole?: RoleName | null;
  organizationType?: OrganizationType | null;
}): ProfileAudience {
  const roles = new Set<RoleName>([
    ...input.roles,
    ...(input.membershipRole ? [input.membershipRole] : []),
  ]);

  if (roles.has(RoleName.DRIVER)) return ProfileAudience.DRIVER;
  if (roles.has(RoleName.ASSOCIATION_ADMIN) || roles.has(RoleName.ASSOCIATION_RESPONDER)) {
    return ProfileAudience.ASSOCIATION;
  }
  if (roles.has(RoleName.SUPPLIER)) return ProfileAudience.SUPPLIER;
  if (roles.has(RoleName.CUSTOMER)) return ProfileAudience.CUSTOMER;

  if (input.organizationType === OrganizationType.MOBILITY_PROVIDER) {
    return ProfileAudience.MOBILITY;
  }
  if (input.organizationType === OrganizationType.SUPPLIER) return ProfileAudience.SUPPLIER;
  if (input.organizationType === OrganizationType.CUSTOMER) return ProfileAudience.CUSTOMER;
  if (input.organizationType === OrganizationType.TRUCK_ASSOCIATION) {
    return ProfileAudience.ASSOCIATION;
  }

  if (
    roles.has(RoleName.FLEET_OWNER) ||
    roles.has(RoleName.FLEET_MANAGER) ||
    roles.has(RoleName.DISPATCHER)
  ) {
    return ProfileAudience.FLEET;
  }
  if (roles.has(RoleName.PLATFORM_ADMIN) || roles.has(RoleName.SUPPORT_AGENT)) {
    return ProfileAudience.PLATFORM;
  }
  return ProfileAudience.FLEET;
}

export function profileBlueprint(audience: ProfileAudience): ProfileSection[] {
  return PROFILE_BLUEPRINTS[audience] ?? PROFILE_BLUEPRINTS[ProfileAudience.FLEET];
}

export function findProfileSection(
  audience: ProfileAudience,
  sectionKey: string,
): ProfileSection | null {
  return profileBlueprint(audience).find((section) => section.key === sectionKey) ?? null;
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export interface SectionCompletion {
  key: string;
  title: string;
  percent: number;
  /** Field labels still missing that the section marks required. */
  missingRequired: string[];
  requiredTotal: number;
  requiredFilled: number;
  optionalTotal: number;
  optionalFilled: number;
  complete: boolean;
}

export interface NextBestAction {
  sectionKey: string;
  sectionTitle: string;
  fieldKey: string;
  fieldLabel: string;
  /** Percentage points completing this section would add. */
  worthPercent: number;
}

export interface ProfileCompletion {
  percent: number;
  sections: SectionCompletion[];
  completedSections: string[];
  nextBestAction: NextBestAction | null;
}

/** A value counts as filled when it is a real answer, not an empty shell. */
export function isFieldFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return false;
}

/**
 * Score a profile against its blueprint.
 *
 * `values` is keyed `sectionKey.fieldKey`, which keeps the same field key usable
 * in two sections (city appears in both personal and business address) without
 * the two colliding.
 */
export function computeProfileCompletion(
  sections: readonly ProfileSection[],
  values: Readonly<Record<string, unknown>>,
): ProfileCompletion {
  const sectionResults: SectionCompletion[] = [];
  let weightedScore = 0;
  let totalWeight = 0;

  for (const section of sections) {
    const required = section.fields.filter((field) => field.required);
    const optional = section.fields.filter((field) => !field.required);

    const missingRequired: string[] = [];
    let requiredFilled = 0;
    for (const field of required) {
      if (isFieldFilled(values[`${section.key}.${field.key}`])) requiredFilled += 1;
      else missingRequired.push(field.label);
    }

    let optionalFilled = 0;
    for (const field of optional) {
      if (isFieldFilled(values[`${section.key}.${field.key}`])) optionalFilled += 1;
    }

    // Required fields decide the score. A section with none falls back to its
    // optional fields so it is not permanently 100% and therefore invisible.
    const fraction =
      required.length > 0
        ? requiredFilled / required.length
        : optional.length > 0
          ? optionalFilled / optional.length
          : 1;

    // A section with no required fields is not automatically complete — that
    // would put a green tick on an untouched Preferences panel. It counts as
    // complete once the user has actually answered something in it.
    const complete =
      required.length > 0
        ? missingRequired.length === 0
        : optional.length === 0 || optionalFilled > 0;

    sectionResults.push({
      key: section.key,
      title: section.title,
      percent: Math.round(fraction * 100),
      missingRequired,
      requiredTotal: required.length,
      requiredFilled,
      optionalTotal: optional.length,
      optionalFilled,
      complete,
    });

    weightedScore += fraction * section.weight;
    totalWeight += section.weight;
  }

  const percent = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;

  // The single most valuable thing to do next: the heaviest incomplete section,
  // and within it the first missing required field. One clear prompt beats a
  // wall of red.
  let nextBestAction: NextBestAction | null = null;
  let bestWeight = -1;

  for (const section of sections) {
    const result = sectionResults.find((entry) => entry.key === section.key);
    if (!result || result.complete) continue;

    if (section.weight > bestWeight) {
      const missingField = section.fields.find(
        (field) => field.required && !isFieldFilled(values[`${section.key}.${field.key}`]),
      );
      if (!missingField) continue;

      bestWeight = section.weight;
      nextBestAction = {
        sectionKey: section.key,
        sectionTitle: section.title,
        fieldKey: missingField.key,
        fieldLabel: missingField.label,
        worthPercent:
          totalWeight > 0
            ? Math.round((section.weight / totalWeight) * 100 * (1 - result.percent / 100))
            : 0,
      };
    }
  }

  return {
    percent,
    sections: sectionResults,
    completedSections: sectionResults.filter((entry) => entry.complete).map((entry) => entry.key),
    nextBestAction,
  };
}

/** Below this a completion prompt is worth showing. */
export const PROFILE_NUDGE_THRESHOLD = 80;
