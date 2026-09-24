import {
  VerificationCheckType,
  VerificationProviderName,
  identityKindForCheckType,
  type VerificationPriceView,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { identityProviderConfigured } from '../../providers/identity';
import { drivingLicenceProvider } from '../../providers/driving-licence';
import { vehicleRcProvider } from '../../providers/vehicle-rc';

/**
 * Verification pricing.
 *
 * The price list lives in `verification_prices`, never in a component: one
 * active, versioned row per check type names the provider it routes to, what
 * that provider charges Saarthi, and the final amount the customer pays. A
 * charge snapshots the row it was sold at, so a later price change never
 * rewrites a past payment.
 *
 * Provider routing is read from the same row. A check is offered only when its
 * configured provider is actually available on this environment — a price for
 * a provider with no adapter or no key is "not available", not a payment taken
 * for a check that cannot run.
 */

export interface ActivePrice {
  checkType: VerificationCheckType;
  provider: VerificationProviderName;
  providerCost: number | null;
  providerCostCurrency: string;
  customerPrice: number;
  currency: string;
  taxTreatment: string;
  pricingVersion: string;
}

/**
 * Whether the provider a check is routed to can run it here.
 *
 * Way2API is the adapter behind every check today. Cashfree's verification
 * API has no identity adapter yet — its account pricing is not known — so a
 * row routed to it is honestly unavailable until one is added.
 */
export function providerAvailable(
  checkType: VerificationCheckType,
  provider: string,
): boolean {
  if (provider !== VerificationProviderName.WAY2API) return false;
  if (identityKindForCheckType(checkType)) return identityProviderConfigured;
  if (checkType === VerificationCheckType.DRIVING_LICENCE) return drivingLicenceProvider !== null;
  if (checkType === VerificationCheckType.VEHICLE_RC) return vehicleRcProvider !== null;
  return false;
}

export async function findActivePrice(
  checkType: VerificationCheckType,
): Promise<ActivePrice | null> {
  const row = await prisma.verificationPrice.findFirst({
    where: { checkType, active: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  return {
    checkType,
    provider: row.provider as VerificationProviderName,
    providerCost: row.providerCost === null ? null : Number(row.providerCost),
    providerCostCurrency: row.providerCostCurrency,
    customerPrice: Number(row.customerPrice),
    currency: row.currency,
    taxTreatment: row.taxTreatment,
    pricingVersion: row.pricingVersion,
  };
}

/** The price in force, or a refusal that says why the check is not offered. */
export async function requireActivePrice(checkType: VerificationCheckType): Promise<ActivePrice> {
  const price = await findActivePrice(checkType);
  if (!price || !providerAvailable(checkType, price.provider)) {
    throw errors.providerNotConfigured(
      'verification',
      'This verification is not available on this environment right now.',
    );
  }
  return price;
}

/** Every check's customer-facing price. Provider cost is never included. */
export async function listPriceViews(): Promise<VerificationPriceView[]> {
  const rows = await prisma.verificationPrice.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });
  return Object.values(VerificationCheckType).flatMap((checkType) => {
    const row = rows.find((entry) => entry.checkType === checkType);
    if (!row) return [];
    return [
      {
        checkType,
        amount: Number(row.customerPrice),
        currency: row.currency,
        available: providerAvailable(checkType, row.provider),
      },
    ];
  });
}

export function toPriceView(price: ActivePrice | null, checkType: VerificationCheckType): VerificationPriceView | null {
  if (!price) return null;
  return {
    checkType,
    amount: price.customerPrice,
    currency: price.currency,
    available: providerAvailable(checkType, price.provider),
  };
}
