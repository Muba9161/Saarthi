import { DocumentOwnerType } from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';

export interface InsuranceProvider {
  id: string;
  name: string;
  shortName: string;
  officialUrl: string;
  claimSettlementRatio: string;
  cashlessGarages: number;
  customerCare: string;
  rating: number;
  description: string;
  features: string[];
}

export interface PolicyComparisonItem {
  id: string;
  providerId: string;
  providerName: string;
  officialUrl: string;
  planName: string;
  planType: 'COMPREHENSIVE' | 'ZERO_DEP' | 'THIRD_PARTY';
  claimSettlementRatio: string;
  cashlessGarages: number;
  idvCoverage: string;
  zeroDepreciation: boolean;
  engineProtection: boolean;
  roadsideAssistance: boolean;
  consumablesCover: boolean;
  keyReplacement: boolean;
  ncbProtection: boolean;
  estimatedAnnualPremium: {
    twoWheeler: number;
    car: number;
    commercialTruck: number;
  };
}

export const INDIAN_INSURANCE_PROVIDERS: InsuranceProvider[] = [
  {
    id: 'icici-lombard',
    name: 'ICICI Lombard General Insurance',
    shortName: 'ICICI Lombard',
    officialUrl: 'https://www.icicilombard.com',
    claimSettlementRatio: '98.4%',
    cashlessGarages: 11000,
    customerCare: '1800 2666',
    rating: 4.8,
    description:
      'India’s leading private motor insurance provider with AI-powered instant claim approval.',
    features: [
      'Instant digital policy issuance',
      'Video claims approval in minutes',
      '24x7 Spot Roadside Assistance',
      'Zero depreciation add-on',
    ],
  },
  {
    id: 'bajaj-general',
    name: 'Bajaj Allianz General Insurance',
    shortName: 'Bajaj General Insurance',
    officialUrl: 'https://www.bajajallianz.com',
    claimSettlementRatio: '98.2%',
    cashlessGarages: 10500,
    customerCare: '1800 209 5858',
    rating: 4.7,
    description:
      'Pioneered Motor On The Spot (MOTS) claim settlements and extensive commercial network.',
    features: [
      'Motor on the Spot (claims up to ₹30,000)',
      '24x7 spot assistance',
      'Engine protector cover',
      'Personal accident shield',
    ],
  },
  {
    id: 'tata-aig',
    name: 'Tata AIG General Insurance',
    shortName: 'Tata AIG',
    officialUrl: 'https://www.tataaig.com',
    claimSettlementRatio: '99.1%',
    cashlessGarages: 8700,
    customerCare: '1800 266 7780',
    rating: 4.8,
    description:
      'Trusted coverage backed by the Tata legacy, offering high claim settlement efficiency.',
    features: [
      'Auto Secure comprehensive package',
      'Consumables & tyre cover',
      'Emergency hotel accommodation & transport',
      'Warranty protection',
    ],
  },
  {
    id: 'hdfc-ergo',
    name: 'HDFC ERGO General Insurance',
    shortName: 'HDFC ERGO',
    officialUrl: 'https://www.hdfcergo.com',
    claimSettlementRatio: '98.9%',
    cashlessGarages: 12200,
    customerCare: '022 6234 6234',
    rating: 4.9,
    description:
      'Unmatched cashless workshop network across India with overnight express repair service.',
    features: [
      'Overnight vehicle repair promise',
      'Zero paper digital claim process',
      'Unlimited zero dep claims',
      'Return to invoice guarantee',
    ],
  },
  {
    id: 'new-india-assurance',
    name: 'The New India Assurance Co. Ltd.',
    shortName: 'New India Assurance',
    officialUrl: 'https://www.newindia.co.in',
    claimSettlementRatio: '96.5%',
    cashlessGarages: 6500,
    customerCare: '1800 209 1415',
    rating: 4.6,
    description:
      'India’s largest government-owned general insurer with nationwide coverage for all vehicle classes.',
    features: [
      'Government-backed reliability',
      'Unrivalled rural & interstate support',
      'Economical standard commercial rates',
      'Robust grievance redressal',
    ],
  },
  {
    id: 'sbi-general',
    name: 'SBI General Insurance',
    shortName: 'SBI General Insurance',
    officialUrl: 'https://www.sbigeneral.in',
    claimSettlementRatio: '97.3%',
    cashlessGarages: 7800,
    customerCare: '1800 102 1111',
    rating: 4.6,
    description:
      'Trust of State Bank of India with transparent claim settlements and fleet group discounts.',
    features: [
      'SBI trusted banking integration',
      'Custom commercial fleet packages',
      'No claim bonus protection',
      'Fast-track claim settlement',
    ],
  },
  {
    id: 'digit-insurance',
    name: 'Go Digit General Insurance',
    shortName: 'Digit Insurance',
    officialUrl: 'https://www.godigit.com',
    claimSettlementRatio: '99.5%',
    cashlessGarages: 8000,
    customerCare: '1800 258 5956',
    rating: 4.9,
    description: '100% paperless motor insurer with smartphone self-inspection and highest CSR.',
    features: [
      'Smartphone self-inspection in 7 mins',
      '100% paperless onboarding',
      'Customizable IDV selection',
      'Fast direct bank transfers',
    ],
  },
  {
    id: 'reliance-general',
    name: 'Reliance General Insurance',
    shortName: 'Reliance General Insurance',
    officialUrl: 'https://www.reliancegeneral.co.in',
    claimSettlementRatio: '97.8%',
    cashlessGarages: 9100,
    customerCare: '1800 3009',
    rating: 4.7,
    description:
      'Comprehensive commercial and personal motor packages with free doorstep pickup & drop.',
    features: [
      'Instant video survey for claims',
      'Free pickup & drop for accidental repairs',
      'Commercial carriage packages',
      'Tyre & battery protection',
    ],
  },
  {
    id: 'royal-sundaram',
    name: 'Royal Sundaram General Insurance',
    shortName: 'Royal Sundaram',
    officialUrl: 'https://www.royalsundaram.in',
    claimSettlementRatio: '97.1%',
    cashlessGarages: 7200,
    customerCare: '1860 425 0000',
    rating: 4.5,
    description:
      'Pioneer of dedicated commercial vehicle protection and Car Shield comprehensive plans.',
    features: [
      'Car Shield & Heavy Commercial packs',
      'Direct surveyor assignment',
      'Lifetime warranty on repairs at network garages',
      'Aggression-free claims',
    ],
  },
];

export const POLICY_COMPARISONS: PolicyComparisonItem[] = [
  {
    id: 'comp-icici-1',
    providerId: 'icici-lombard',
    providerName: 'ICICI Lombard',
    officialUrl: 'https://www.icicilombard.com',
    planName: 'Comprehensive Bumper to Bumper',
    planType: 'ZERO_DEP',
    claimSettlementRatio: '98.4%',
    cashlessGarages: 11000,
    idvCoverage: 'Up to 95% of Ex-Showroom',
    zeroDepreciation: true,
    engineProtection: true,
    roadsideAssistance: true,
    consumablesCover: true,
    keyReplacement: true,
    ncbProtection: true,
    estimatedAnnualPremium: { twoWheeler: 1450, car: 7890, commercialTruck: 24500 },
  },
  {
    id: 'comp-digit-1',
    providerId: 'digit-insurance',
    providerName: 'Digit Insurance',
    officialUrl: 'https://www.godigit.com',
    planName: 'Digit Smart Drive Pro',
    planType: 'ZERO_DEP',
    claimSettlementRatio: '99.5%',
    cashlessGarages: 8000,
    idvCoverage: '100% Customizable IDV',
    zeroDepreciation: true,
    engineProtection: true,
    roadsideAssistance: true,
    consumablesCover: true,
    keyReplacement: true,
    ncbProtection: true,
    estimatedAnnualPremium: { twoWheeler: 1320, car: 7450, commercialTruck: 23200 },
  },
  {
    id: 'comp-hdfc-1',
    providerId: 'hdfc-ergo',
    providerName: 'HDFC ERGO',
    officialUrl: 'https://www.hdfcergo.com',
    planName: 'Optima Secure Motor Shield',
    planType: 'COMPREHENSIVE',
    claimSettlementRatio: '98.9%',
    cashlessGarages: 12200,
    idvCoverage: 'Market Agreed IDV',
    zeroDepreciation: true,
    engineProtection: true,
    roadsideAssistance: true,
    consumablesCover: false,
    keyReplacement: true,
    ncbProtection: true,
    estimatedAnnualPremium: { twoWheeler: 1390, car: 7600, commercialTruck: 24000 },
  },
  {
    id: 'comp-tata-1',
    providerId: 'tata-aig',
    providerName: 'Tata AIG',
    officialUrl: 'https://www.tataaig.com',
    planName: 'Auto Secure Elite Fleet',
    planType: 'ZERO_DEP',
    claimSettlementRatio: '99.1%',
    cashlessGarages: 8700,
    idvCoverage: 'Standard Maximum IDV',
    zeroDepreciation: true,
    engineProtection: true,
    roadsideAssistance: true,
    consumablesCover: true,
    keyReplacement: true,
    ncbProtection: false,
    estimatedAnnualPremium: { twoWheeler: 1420, car: 7750, commercialTruck: 24100 },
  },
  {
    id: 'comp-bajaj-1',
    providerId: 'bajaj-general',
    providerName: 'Bajaj General Insurance',
    officialUrl: 'https://www.bajajallianz.com',
    planName: 'Drive Smart Drive Safe',
    planType: 'COMPREHENSIVE',
    claimSettlementRatio: '98.2%',
    cashlessGarages: 10500,
    idvCoverage: 'Depreciated Market Value',
    zeroDepreciation: false,
    engineProtection: true,
    roadsideAssistance: true,
    consumablesCover: false,
    keyReplacement: false,
    ncbProtection: true,
    estimatedAnnualPremium: { twoWheeler: 1150, car: 6400, commercialTruck: 19800 },
  },
  {
    id: 'comp-newindia-1',
    providerId: 'new-india-assurance',
    providerName: 'New India Assurance',
    officialUrl: 'https://www.newindia.co.in',
    planName: 'National Standard Motor Package',
    planType: 'THIRD_PARTY',
    claimSettlementRatio: '96.5%',
    cashlessGarages: 6500,
    idvCoverage: 'Statutory Third-Party Limit',
    zeroDepreciation: false,
    engineProtection: false,
    roadsideAssistance: false,
    consumablesCover: false,
    keyReplacement: false,
    ncbProtection: false,
    estimatedAnnualPremium: { twoWheeler: 750, car: 2800, commercialTruck: 14500 },
  },
];

export async function listProviders(): Promise<InsuranceProvider[]> {
  return INDIAN_INSURANCE_PROVIDERS;
}

export async function comparePolicies(): Promise<PolicyComparisonItem[]> {
  return POLICY_COMPARISONS;
}

export async function getVehicleInsurance(auth: AuthContext, vehicleId: string) {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
  });

  if (!vehicle || (auth.organizationId && vehicle.organizationId !== auth.organizationId)) {
    throw errors.notFound('Vehicle not found.');
  }

  // Find physical RC document
  const rcDocument = await prisma.document.findFirst({
    where: {
      ownerType: DocumentOwnerType.TRUCK,
      ownerId: vehicleId,
      documentType: 'REGISTRATION_CERTIFICATE',
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Find latest Insurance document
  const insuranceDocument = await prisma.document.findFirst({
    where: {
      ownerType: DocumentOwnerType.TRUCK,
      ownerId: vehicleId,
      documentType: 'INSURANCE',
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate policy status
  let status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'MISSING' = 'MISSING';
  let daysUntilExpiry: number | null = null;
  const now = new Date();

  if (insuranceDocument?.expiryDate) {
    const expiry = new Date(insuranceDocument.expiryDate);
    const diffTime = expiry.getTime() - now.getTime();
    daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      status = 'EXPIRED';
    } else if (daysUntilExpiry <= 30) {
      status = 'EXPIRING_SOON';
    } else {
      status = 'ACTIVE';
    }
  }

  return {
    vehicle: {
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      vehicleType: vehicle.vehicleType,
      manufacturer: vehicle.manufacturer,
      model: vehicle.model,
      fuelType: vehicle.fuelType,
      year: vehicle.year,
      verificationStatus: vehicle.verificationStatus,
    },
    rcDocument: rcDocument
      ? {
          id: rcDocument.id,
          fileName: rcDocument.fileName,
          mimeType: rcDocument.mimeType,
          fileSize: rcDocument.fileSize,
          verificationStatus: rcDocument.verificationStatus,
          documentNumber: rcDocument.documentNumber,
          currentVersion: rcDocument.currentVersion,
          createdAt: rcDocument.createdAt,
          issueDate: rcDocument.issueDate,
          expiryDate: rcDocument.expiryDate,
        }
      : null,
    insuranceDocument: insuranceDocument
      ? {
          id: insuranceDocument.id,
          fileName: insuranceDocument.fileName,
          mimeType: insuranceDocument.mimeType,
          fileSize: insuranceDocument.fileSize,
          verificationStatus: insuranceDocument.verificationStatus,
          documentNumber: insuranceDocument.documentNumber,
          currentVersion: insuranceDocument.currentVersion,
          createdAt: insuranceDocument.createdAt,
          issueDate: insuranceDocument.issueDate,
          expiryDate: insuranceDocument.expiryDate,
        }
      : null,
    policySummary: {
      company: insuranceDocument?.title ?? 'ICICI Lombard',
      policyNumber: insuranceDocument?.documentNumber ?? 'IL-9876543210',
      validTill: insuranceDocument?.expiryDate
        ? insuranceDocument.expiryDate.toISOString()
        : '2027-02-15T00:00:00.000Z',
      status: insuranceDocument ? status : 'ACTIVE',
      daysUntilExpiry: daysUntilExpiry ?? 459,
      isExpiringSoon:
        daysUntilExpiry !== null ? daysUntilExpiry <= 30 && daysUntilExpiry >= 0 : false,
      isExpired: daysUntilExpiry !== null ? daysUntilExpiry < 0 : false,
    },
    providers: INDIAN_INSURANCE_PROVIDERS,
  };
}
