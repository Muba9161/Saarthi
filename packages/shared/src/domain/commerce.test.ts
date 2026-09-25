import { describe, expect, it } from 'vitest';
import {
  type CommerceAttributeDefinition,
  type CommerceCategoryNode,
  buildTaxonomyIndex,
  confidenceBand,
  effectiveAttributes,
  scoreListingMatch,
  validateAttributeValues,
} from './commerce';
import {
  classifyCategory,
  extractCommercialFields,
  interpretCommerceText,
} from './commerce-extraction';
import { canCommunicate, communicationPartyForOrganizationType } from './communication';
import {
  CommerceAttributeScope,
  CommerceAttributeType,
  CommerceCategoryStatus,
  MaterialUnit,
  OrganizationType,
} from './enums';

let sequence = 0;
function attribute(
  key: string,
  overrides: Partial<CommerceAttributeDefinition> = {},
): CommerceAttributeDefinition {
  return {
    id: `attr-${key}-${(sequence += 1)}`,
    key,
    label: key,
    type: CommerceAttributeType.TEXT,
    required: false,
    unit: null,
    options: [],
    validation: null,
    scope: CommerceAttributeScope.BOTH,
    sortOrder: 0,
    ...overrides,
  };
}

function node(
  id: string,
  name: string,
  parentId: string | null,
  overrides: Partial<CommerceCategoryNode> = {},
): CommerceCategoryNode {
  return {
    id,
    parentId,
    name,
    slug: id,
    description: null,
    status: CommerceCategoryStatus.ACTIVE,
    isFallback: false,
    defaultUnit: null,
    sortOrder: 0,
    aliases: [],
    attributes: [],
    ...overrides,
  };
}

const index = buildTaxonomyIndex([
  node('construction', 'Construction Materials', null, { defaultUnit: MaterialUnit.TON }),
  node('sand', 'Sand', 'construction', {
    aliases: ['ret'],
    attributes: [
      attribute('grade', {
        type: CommerceAttributeType.SELECT,
        required: true,
        options: ['Fine', 'Medium', 'Coarse'],
      }),
    ],
  }),
  node('river-sand', 'River Sand', 'sand'),
  node('m-sand', 'Manufactured Sand', 'sand', { aliases: ['m-sand'] }),
  node('furniture', 'Furniture', null, {
    defaultUnit: MaterialUnit.PIECE,
    attributes: [
      attribute('material', {
        type: CommerceAttributeType.SELECT,
        options: ['Teak', 'Sheesham', 'Wood', 'Metal'],
      }),
    ],
  }),
  node('tables', 'Tables', 'furniture'),
  node('dining', 'Dining Table', 'tables', {
    attributes: [
      attribute('seating_capacity', { type: CommerceAttributeType.NUMBER, unit: 'seater' }),
      attribute('brand', { scope: CommerceAttributeScope.PRODUCT }),
    ],
  }),
  node('wood', 'Wood & Timber', null),
  node('teak-wood', 'Teak Wood', 'wood'),
  node('steel', 'Metal & Steel', null, { aliases: ['steel'] }),
  node('wardrobe', 'Wardrobe', 'furniture', { aliases: ['almirah'] }),
  node('retired', 'Retired Goods', null, { status: CommerceCategoryStatus.INACTIVE }),
  node('other', 'Other', null, { isFallback: true }),
]);

describe('commerce taxonomy', () => {
  it('inherits attributes down the tree and filters by scope', () => {
    const product = effectiveAttributes(index, 'dining', 'PRODUCT').map((field) => field.key);
    const requirement = effectiveAttributes(index, 'dining', 'REQUIREMENT').map(
      (field) => field.key,
    );
    expect(product).toEqual(expect.arrayContaining(['material', 'seating_capacity', 'brand']));
    expect(requirement).not.toContain('brand');
  });

  it('drops unknown keys, coerces types and rejects values off the option list', () => {
    const fields = effectiveAttributes(index, 'dining', 'PRODUCT');
    const result = validateAttributeValues(fields, {
      material: 'teak',
      seating_capacity: '6',
      invented_column: 'x',
    });
    expect(result.values).toEqual({ material: 'Teak', seating_capacity: 6 });
    expect(result.values).not.toHaveProperty('invented_column');

    expect(validateAttributeValues(fields, { material: 'Gold' }).errors.material).toBeDefined();
  });

  it('reports required attributes that have no value', () => {
    const fields = effectiveAttributes(index, 'river-sand', 'REQUIREMENT');
    expect(validateAttributeValues(fields, {}).missing).toEqual(['grade']);
  });

  it('bands confidence', () => {
    expect(confidenceBand(0.95)).toBe('HIGH');
    expect(confidenceBand(0.7)).toBe('MEDIUM');
    expect(confidenceBand(0.2)).toBe('LOW');
  });
});

describe('deterministic classification', () => {
  it('prefers the most specific node', () => {
    expect(classifyCategory(index, 'River sand, 40 tons')?.categoryId).toBe('river-sand');
  });

  it('treats the head noun as the product and a material as its attribute', () => {
    const result = classifyCategory(index, 'Teak wood 6-seater dining table');
    expect(result?.categoryId).toBe('dining');
    expect(result?.alternativeIds).toEqual([]);
    expect(confidenceBand(result!.score)).toBe('HIGH');
  });

  it('matches aliases and plurals', () => {
    expect(classifyCategory(index, 'steel almirah')?.categoryId).toBe('wardrobe');
    expect(classifyCategory(index, '20 dining tables')?.categoryId).toBe('dining');
    expect(classifyCategory(index, 'need m-sand urgently')?.categoryId).toBe('m-sand');
  });

  it('is only moderately sure of a parent with children', () => {
    const result = classifyCategory(index, 'sand for my site');
    expect(result?.categoryId).toBe('sand');
    expect(confidenceBand(result!.score)).toBe('MEDIUM');
  });

  it('ignores inactive categories and unknown goods', () => {
    expect(classifyCategory(index, 'retired goods')).toBeNull();
    expect(classifyCategory(index, 'a specialised industrial widget')).toBeNull();
  });
});

describe('commercial extraction', () => {
  it('reads price, stock and seating from a seller line', () => {
    const fields = extractCommercialFields('Teak 6-seater dining table ₹25,000, 5 available');
    expect(fields.pricePerUnit).toBe(25_000);
    expect(fields.stock).toBe(5);
    expect(fields.quantity).toBeNull();
  });

  it('reads quantity, unit, route and timing from a customer line', () => {
    const fields = extractCommercialFields(
      'I need 25 tons of river sand from Saharanpur to Lucknow within 3 days.',
    );
    expect(fields).toMatchObject({
      quantity: 25,
      unit: MaterialUnit.TON,
      pickupCity: 'Saharanpur',
      deliveryCity: 'Lucknow',
      requiredWithinDays: 3,
    });
  });

  it('reads a per-unit price', () => {
    const fields = extractCommercialFields('River sand ₹2,000/ton, 40 tons in stock');
    expect(fields.pricePerUnit).toBe(2_000);
    expect(fields.unit).toBe(MaterialUnit.TON);
    expect(fields.stock).toBe(40);
  });
});

describe('interpretation', () => {
  it('asks a seller only for what the line did not say', () => {
    const result = interpretCommerceText(index, 'Wooden dining table', 'PRODUCT');
    expect(result.category?.id).toBe('dining');
    expect(result.category?.path.map((entry) => entry.name)).toEqual([
      'Furniture',
      'Tables',
      'Dining Table',
    ]);
    expect(result.attributes.material).toBe('Wood');
    expect(result.commercial.unit).toBe(MaterialUnit.PIECE);
    expect(result.missing).toEqual(['pricePerUnit', 'stock']);
  });

  it('does not ask again for what the line already stated', () => {
    const result = interpretCommerceText(
      index,
      'Teak 6-seater dining table ₹25,000, 5 available',
      'PRODUCT',
    );
    expect(result.attributes).toMatchObject({ material: 'Teak', seating_capacity: 6 });
    expect(result.commercial).toMatchObject({ pricePerUnit: 25_000, stock: 5 });
    expect(result.missing).toEqual([]);
    expect(result.confidence).toBe('HIGH');
  });

  it('asks a customer for the grade of sand', () => {
    const result = interpretCommerceText(
      index,
      'I need 25 tons of river sand from Saharanpur to Lucknow within 3 days.',
      'REQUIREMENT',
    );
    expect(result.category?.id).toBe('river-sand');
    expect(result.missing).toEqual(['grade']);
  });

  it('reads a bare count before the product noun', () => {
    const result = interpretCommerceText(index, 'I need 20 teak dining tables', 'REQUIREMENT');
    expect(result.commercial).toMatchObject({ quantity: 20, unit: MaterialUnit.PIECE });
    expect(result.attributes.material).toBe('Teak');
  });

  it('falls back to Other with low confidence', () => {
    const result = interpretCommerceText(index, 'I sell a specialised industrial item', 'PRODUCT');
    expect(result.category?.id).toBe('other');
    expect(result.confidence).toBe('LOW');
  });

  it('never overrides a value the user locked', () => {
    const result = interpretCommerceText(index, 'Teak dining table', 'PRODUCT', {
      locked: { attributes: { material: 'Sheesham' } },
      suggested: { categoryId: 'dining', score: 0.7, attributes: { material: 'Metal' } },
    });
    expect(result.attributes.material).toBe('Sheesham');
  });

  it('keeps a locked category even when the text says otherwise', () => {
    const result = interpretCommerceText(index, 'river sand', 'PRODUCT', {
      locked: { categoryId: 'm-sand' },
    });
    expect(result.category?.id).toBe('m-sand');
  });

  it('uses a validated suggestion only when the text alone is weaker', () => {
    const result = interpretCommerceText(index, 'I sell almari', 'PRODUCT', {
      suggested: {
        categoryId: 'wardrobe',
        score: 0.7,
        attributes: { material: 'Metal', bogus: 1 },
      },
    });
    expect(result.category?.id).toBe('wardrobe');
    expect(result.confidence).toBe('MEDIUM');
    expect(result.attributes).toEqual({ material: 'Metal' });
  });
});

describe('listing matching', () => {
  const requirement = {
    categoryId: 'river-sand',
    attributes: { grade: 'Fine' },
    quantity: 25,
    unit: MaterialUnit.TON,
  };

  it('scores an exact product with enough stock highly', () => {
    const match = scoreListingMatch(index, {
      requirement,
      listing: {
        categoryId: 'river-sand',
        attributes: { grade: 'Fine' },
        availableQuantity: 40,
        minimumOrderQty: 1,
        unit: MaterialUnit.TON,
      },
      distanceKm: 20,
    });
    expect(match?.categoryMatch).toBe('EXACT');
    expect(match?.stockSufficient).toBe(true);
    expect(match!.score).toBeGreaterThan(90);
  });

  it('ranks insufficient stock and differing details lower', () => {
    const exact = scoreListingMatch(index, {
      requirement,
      listing: {
        categoryId: 'river-sand',
        attributes: { grade: 'Fine' },
        availableQuantity: 40,
        minimumOrderQty: 1,
        unit: MaterialUnit.TON,
      },
      distanceKm: null,
    })!;
    const weaker = scoreListingMatch(index, {
      requirement,
      listing: {
        categoryId: 'river-sand',
        attributes: { grade: 'Coarse' },
        availableQuantity: 10,
        minimumOrderQty: 1,
        unit: MaterialUnit.TON,
      },
      distanceKm: null,
    })!;
    expect(weaker.stockSufficient).toBe(false);
    expect(weaker.conflictingAttributes).toEqual(['grade']);
    expect(weaker.score).toBeLessThan(exact.score);
  });

  it('accepts a listing filed more generally, and refuses an unrelated one', () => {
    const general = scoreListingMatch(index, {
      requirement,
      listing: {
        categoryId: 'sand',
        attributes: {},
        availableQuantity: 40,
        minimumOrderQty: 1,
        unit: MaterialUnit.TON,
      },
      distanceKm: null,
    });
    expect(general?.categoryMatch).toBe('MORE_GENERAL');

    const unrelated = scoreListingMatch(index, {
      requirement,
      listing: {
        categoryId: 'dining',
        attributes: {},
        availableQuantity: 40,
        minimumOrderQty: 1,
        unit: MaterialUnit.PIECE,
      },
      distanceKm: null,
    });
    expect(unrelated).toBeNull();
  });

  it('does not compare stock across different units', () => {
    const match = scoreListingMatch(index, {
      requirement,
      listing: {
        categoryId: 'river-sand',
        attributes: {},
        availableQuantity: 5,
        minimumOrderQty: 1,
        unit: MaterialUnit.TRIP,
      },
      distanceKm: null,
    });
    expect(match?.stockSufficient).toBeNull();
  });
});

describe('communication boundary', () => {
  const party = communicationPartyForOrganizationType;

  it.each([
    ['CUSTOMER', 'FLEET_OWNER', true],
    ['FLEET_OWNER', 'SELLER', true],
    ['CUSTOMER', 'SELLER', false],
    ['CUSTOMER', 'DRIVER', false],
    ['SELLER', 'CUSTOMER', false],
    ['DRIVER', 'CUSTOMER', false],
    ['PLATFORM', 'SELLER', true],
  ] as const)('%s → %s is %s', (from, to, allowed) => {
    expect(canCommunicate(from, to)).toBe(allowed);
  });

  it('maps organization types to parties', () => {
    expect(party(OrganizationType.SUPPLIER)).toBe('SELLER');
    expect(party(OrganizationType.ENTERPRISE)).toBe('FLEET_OWNER');
    expect(party(OrganizationType.CUSTOMER)).toBe('CUSTOMER');
    expect(party(null)).toBe('OTHER');
  });
});
