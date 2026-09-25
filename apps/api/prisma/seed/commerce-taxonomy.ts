import {
  type PrismaClient,
  CommerceAttributeScope,
  CommerceAttributeType,
  MaterialUnit,
} from '@prisma/client';

/**
 * Starter commerce taxonomy.
 *
 * Reference data, not demand: it describes kinds of goods, never a seller or a
 * listing. It exists so the first seller to type "river sand" is understood
 * without an administrator having to build the tree first.
 *
 * Create-only. Once a node exists the database owns it, so an administrator's
 * rename, new attribute or deactivation survives every later deploy — the seed
 * never writes over a row it did not just create.
 */

interface SeedAttribute {
  key: string;
  label: string;
  type: CommerceAttributeType;
  required?: boolean;
  unit?: string;
  options?: string[];
  scope?: CommerceAttributeScope;
  validation?: { min?: number; max?: number; maxLength?: number };
}

interface SeedCategory {
  slug: string;
  name: string;
  defaultUnit?: MaterialUnit;
  aliases?: string[];
  attributes?: SeedAttribute[];
  children?: SeedCategory[];
  isFallback?: boolean;
}

const { TEXT, NUMBER, SELECT, BOOLEAN } = CommerceAttributeType;
const { PRODUCT } = CommerceAttributeScope;

const brand: SeedAttribute = { key: 'brand', label: 'Brand', type: TEXT, scope: PRODUCT };
const thicknessMm: SeedAttribute = {
  key: 'thickness',
  label: 'Thickness',
  type: NUMBER,
  unit: 'mm',
  required: true,
  validation: { min: 0.1, max: 500 },
};
const seating: SeedAttribute = {
  key: 'seating_capacity',
  label: 'Seating capacity',
  type: NUMBER,
  unit: 'seater',
  validation: { min: 1, max: 20 },
};

export const COMMERCE_TAXONOMY: SeedCategory[] = [
  {
    slug: 'construction-materials',
    name: 'Construction Materials',
    defaultUnit: MaterialUnit.TON,
    aliases: ['building material'],
    children: [
      {
        slug: 'sand',
        name: 'Sand',
        defaultUnit: MaterialUnit.TON,
        aliases: ['ret', 'reti', 'balu'],
        attributes: [
          {
            key: 'grade',
            label: 'Grade',
            type: SELECT,
            required: true,
            options: ['Fine', 'Medium', 'Coarse'],
          },
          { key: 'washed', label: 'Washed', type: BOOLEAN },
        ],
        children: [
          { slug: 'river-sand', name: 'River Sand', aliases: ['nadi ret', 'yamuna sand'] },
          {
            slug: 'manufactured-sand',
            name: 'Manufactured Sand',
            aliases: ['m-sand', 'm sand', 'msand', 'crushed sand'],
          },
          { slug: 'plaster-sand', name: 'Plaster Sand', aliases: ['p-sand', 'p sand'] },
        ],
      },
      {
        slug: 'aggregate',
        name: 'Aggregate',
        defaultUnit: MaterialUnit.TON,
        aliases: ['gitti', 'crushed stone', 'stone chips', 'bajri'],
        attributes: [
          {
            key: 'size',
            label: 'Size',
            type: SELECT,
            required: true,
            options: ['6 mm', '10 mm', '12 mm', '20 mm', '40 mm'],
          },
        ],
      },
      {
        slug: 'cement',
        name: 'Cement',
        defaultUnit: MaterialUnit.BAG,
        attributes: [
          {
            key: 'cement_type',
            label: 'Cement type',
            type: SELECT,
            required: true,
            options: ['OPC 43', 'OPC 53', 'PPC', 'PSC'],
          },
          brand,
        ],
      },
      {
        slug: 'bricks-blocks',
        name: 'Bricks & Blocks',
        defaultUnit: MaterialUnit.PIECE,
        aliases: ['bricks', 'eent'],
        children: [
          {
            slug: 'red-clay-bricks',
            name: 'Red Clay Bricks',
            aliases: ['red bricks', 'lal eent'],
            attributes: [
              {
                key: 'class',
                label: 'Class',
                type: SELECT,
                options: ['First class', 'Second class'],
              },
            ],
          },
          { slug: 'fly-ash-bricks', name: 'Fly Ash Bricks', aliases: ['flyash bricks'] },
          {
            slug: 'concrete-blocks',
            name: 'Concrete Blocks',
            aliases: ['aac blocks', 'cement blocks'],
          },
        ],
      },
      {
        slug: 'hardware-fittings',
        name: 'Hardware & Fittings',
        defaultUnit: MaterialUnit.PIECE,
        aliases: ['hardware', 'nails', 'screws', 'fasteners', 'hinges'],
      },
      {
        slug: 'tiles',
        name: 'Tiles',
        defaultUnit: MaterialUnit.PIECE,
        aliases: ['floor tiles', 'wall tiles', 'vitrified tiles'],
      },
    ],
  },
  {
    slug: 'metal-steel',
    name: 'Metal & Steel',
    defaultUnit: MaterialUnit.TON,
    aliases: ['steel', 'loha'],
    children: [
      {
        slug: 'tmt-bars',
        name: 'TMT Bars',
        aliases: ['tmt', 'saria', 'sariya', 'rebar', 'steel bars'],
        attributes: [
          {
            key: 'diameter',
            label: 'Diameter',
            type: NUMBER,
            unit: 'mm',
            required: true,
            validation: { min: 4, max: 60 },
          },
          {
            key: 'grade',
            label: 'Grade',
            type: SELECT,
            required: true,
            options: ['Fe 415', 'Fe 500', 'Fe 500D', 'Fe 550'],
          },
          brand,
        ],
      },
      {
        slug: 'steel-sheets',
        name: 'Steel Sheets',
        aliases: ['ms sheet', 'gi sheet', 'steel plate'],
        attributes: [thicknessMm],
      },
      { slug: 'steel-pipes', name: 'Steel Pipes', aliases: ['ms pipe', 'gi pipe'] },
      {
        slug: 'structural-steel',
        name: 'Structural Steel',
        aliases: ['steel angle', 'steel channel', 'girder', 'i beam'],
      },
    ],
  },
  {
    slug: 'wood-timber',
    name: 'Wood & Timber',
    defaultUnit: MaterialUnit.CUBIC_METER,
    aliases: ['wood', 'lakdi'],
    children: [
      {
        slug: 'timber',
        name: 'Timber',
        aliases: ['lumber', 'wood logs'],
        attributes: [{ key: 'seasoned', label: 'Seasoned', type: BOOLEAN }],
        children: [
          { slug: 'teak-wood', name: 'Teak Wood', aliases: ['teak timber', 'sagwan'] },
          { slug: 'sal-wood', name: 'Sal Wood', aliases: ['sal timber'] },
          { slug: 'sheesham-wood', name: 'Sheesham Wood', aliases: ['shisham', 'sheesham timber'] },
        ],
      },
      {
        slug: 'plywood',
        name: 'Plywood',
        defaultUnit: MaterialUnit.PIECE,
        aliases: ['ply', 'plyboard'],
        attributes: [
          thicknessMm,
          {
            key: 'ply_grade',
            label: 'Grade',
            type: SELECT,
            options: ['MR', 'BWR', 'BWP', 'Marine'],
          },
        ],
      },
      {
        slug: 'boards-panels',
        name: 'Boards & Panels',
        defaultUnit: MaterialUnit.PIECE,
        aliases: ['mdf', 'particle board', 'hdf', 'block board'],
      },
    ],
  },
  {
    slug: 'furniture',
    name: 'Furniture',
    defaultUnit: MaterialUnit.PIECE,
    attributes: [
      {
        key: 'material',
        label: 'Material',
        type: SELECT,
        options: [
          'Teak',
          'Sheesham',
          'Mango Wood',
          'Engineered Wood',
          'Wood',
          'Metal',
          'Glass',
          'Plastic',
        ],
      },
    ],
    children: [
      {
        slug: 'tables',
        name: 'Tables',
        aliases: ['table', 'mez'],
        children: [
          {
            slug: 'dining-tables',
            name: 'Dining Table',
            aliases: ['dinner table', 'dining set'],
            attributes: [seating],
          },
          { slug: 'office-tables', name: 'Office Table', aliases: ['office desk', 'work desk'] },
          {
            slug: 'coffee-tables',
            name: 'Coffee Table',
            aliases: ['center table', 'centre table', 'tea table'],
          },
        ],
      },
      {
        slug: 'chairs',
        name: 'Chairs',
        aliases: ['chair', 'kursi'],
        children: [
          {
            slug: 'office-chairs',
            name: 'Office Chair',
            aliases: ['revolving chair', 'ergonomic chair'],
          },
          { slug: 'plastic-chairs', name: 'Plastic Chair' },
        ],
      },
      {
        slug: 'beds',
        name: 'Beds',
        aliases: ['bed', 'palang', 'cot'],
        attributes: [
          {
            key: 'bed_size',
            label: 'Size',
            type: SELECT,
            options: ['Single', 'Double', 'Queen', 'King'],
          },
        ],
      },
      {
        slug: 'sofas',
        name: 'Sofas',
        aliases: ['sofa', 'couch', 'sofa set'],
        attributes: [seating],
      },
      {
        slug: 'storage-furniture',
        name: 'Storage Furniture',
        aliases: ['storage unit'],
        children: [
          { slug: 'wardrobes', name: 'Wardrobe', aliases: ['almirah', 'almari', 'cupboard'] },
          { slug: 'cabinets', name: 'Cabinet', aliases: ['kitchen cabinet', 'file cabinet'] },
        ],
      },
    ],
  },
  {
    slug: 'electronics',
    name: 'Electronics',
    defaultUnit: MaterialUnit.PIECE,
    children: [
      {
        slug: 'electrical-cables',
        name: 'Electrical Cables & Wires',
        aliases: ['electric wire', 'cable', 'wire'],
      },
      { slug: 'lighting', name: 'Lighting', aliases: ['led light', 'bulb', 'tube light'] },
      { slug: 'appliances', name: 'Appliances', aliases: ['appliance'] },
    ],
  },
  {
    slug: 'agriculture',
    name: 'Agriculture',
    defaultUnit: MaterialUnit.TON,
    children: [
      {
        slug: 'grains',
        name: 'Grains',
        aliases: ['grain', 'anaj'],
        children: [
          { slug: 'wheat', name: 'Wheat', aliases: ['gehun', 'gehu'] },
          { slug: 'rice', name: 'Rice', aliases: ['chawal', 'paddy'] },
          { slug: 'maize', name: 'Maize', aliases: ['corn', 'makka'] },
        ],
      },
      {
        slug: 'fertilizers',
        name: 'Fertilizers',
        defaultUnit: MaterialUnit.BAG,
        aliases: ['fertilizer', 'urea', 'dap', 'khad'],
      },
      { slug: 'seeds', name: 'Seeds', defaultUnit: MaterialUnit.KG, aliases: ['seed', 'beej'] },
    ],
  },
  {
    slug: 'industrial-equipment',
    name: 'Industrial Equipment',
    defaultUnit: MaterialUnit.PIECE,
    children: [
      {
        slug: 'generators',
        name: 'Generators',
        aliases: ['generator', 'genset', 'dg set'],
        attributes: [
          {
            key: 'capacity_kva',
            label: 'Capacity',
            type: NUMBER,
            unit: 'kva',
            validation: { min: 1 },
          },
        ],
      },
      { slug: 'pumps', name: 'Pumps', aliases: ['pump', 'water pump', 'motor pump'] },
      {
        slug: 'construction-machinery',
        name: 'Construction Machinery',
        aliases: ['concrete mixer', 'mixer machine', 'vibrator machine'],
      },
    ],
  },
  {
    slug: 'home-kitchen',
    name: 'Home & Kitchen',
    defaultUnit: MaterialUnit.PIECE,
    children: [
      { slug: 'cookware', name: 'Cookware', aliases: ['utensils', 'bartan'] },
      {
        slug: 'sanitaryware',
        name: 'Sanitaryware',
        aliases: ['wash basin', 'commode', 'toilet seat'],
      },
    ],
  },
  {
    slug: 'automotive',
    name: 'Automotive',
    defaultUnit: MaterialUnit.PIECE,
    children: [
      {
        slug: 'spare-parts',
        name: 'Spare Parts',
        aliases: ['spares', 'auto parts', 'spare part'],
        attributes: [{ key: 'vehicle_model', label: 'Fits vehicle', type: TEXT }],
      },
      {
        slug: 'tyres',
        name: 'Tyres',
        aliases: ['tyre', 'tire', 'tires'],
        attributes: [{ key: 'tyre_size', label: 'Size', type: TEXT }],
      },
      {
        slug: 'lubricants',
        name: 'Lubricants',
        defaultUnit: MaterialUnit.LITRE,
        aliases: ['engine oil', 'lubricant', 'grease', 'gear oil'],
      },
      { slug: 'batteries', name: 'Batteries', aliases: ['battery'] },
    ],
  },
  {
    slug: 'textiles',
    name: 'Textiles',
    children: [
      { slug: 'fabric', name: 'Fabric', aliases: ['cloth', 'kapda'] },
      { slug: 'yarn', name: 'Yarn', defaultUnit: MaterialUnit.KG, aliases: ['thread', 'dhaga'] },
    ],
  },
  {
    // The generic fallback. It asks for nothing beyond the commercial basics and
    // one free-text line, so an item Saarthi has never heard of can still be
    // listed or requested — and repeated "Other" usage tells an administrator
    // which category to add next.
    slug: 'other',
    name: 'Other',
    isFallback: true,
    attributes: [
      { key: 'key_details', label: 'Key details', type: TEXT, validation: { maxLength: 200 } },
    ],
  },
];

async function seedNode(
  prisma: PrismaClient,
  node: SeedCategory,
  parentId: string | null,
  sortOrder: number,
): Promise<void> {
  const category = await prisma.commerceCategory.upsert({
    where: { slug: node.slug },
    create: {
      slug: node.slug,
      name: node.name,
      parentId,
      defaultUnit: node.defaultUnit ?? null,
      isFallback: node.isFallback ?? false,
      sortOrder,
    },
    update: {},
  });

  for (const [index, attribute] of (node.attributes ?? []).entries()) {
    await prisma.commerceCategoryAttribute.upsert({
      where: { categoryId_key: { categoryId: category.id, key: attribute.key } },
      create: {
        categoryId: category.id,
        key: attribute.key,
        label: attribute.label,
        type: attribute.type,
        required: attribute.required ?? false,
        unit: attribute.unit ?? null,
        options: attribute.options ?? [],
        validation: attribute.validation ?? undefined,
        scope: attribute.scope ?? CommerceAttributeScope.BOTH,
        sortOrder: index * 10,
      },
      update: {},
    });
  }

  if (node.aliases?.length) {
    await prisma.commerceCategoryAlias.createMany({
      data: node.aliases.map((alias) => ({ categoryId: category.id, alias })),
      skipDuplicates: true,
    });
  }

  for (const [index, child] of (node.children ?? []).entries()) {
    await seedNode(prisma, child, category.id, index * 10);
  }
}

export async function seedCommerceTaxonomy(prisma: PrismaClient): Promise<void> {
  for (const [index, node] of COMMERCE_TAXONOMY.entries()) {
    await seedNode(prisma, node, null, index * 10);
  }
}
