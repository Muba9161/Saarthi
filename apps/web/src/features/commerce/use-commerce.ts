import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type CommerceAttributeDefinition,
  type CommerceAttributeValue,
  type CommerceAttributeValues,
  type CommerceCategoryNode,
  type CommerceCommercialFields,
  type CommerceConfidence,
  type CommerceInterpretation,
  type CommerceRecordScope,
  type CommerceTaxonomyIndex,
  buildTaxonomyIndex,
  categoryRef,
  effectiveAttributes,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';

export const COMMERCE_CATEGORIES_KEY = ['commerce', 'categories'] as const;

/** The active taxonomy, indexed for breadcrumbs and schema lookups. */
export function useCommerceTaxonomy(): {
  index: CommerceTaxonomyIndex | null;
  isLoading: boolean;
  error: unknown;
} {
  const query = useQuery({
    queryKey: COMMERCE_CATEGORIES_KEY,
    queryFn: () => api.get<CommerceCategoryNode[]>('/commerce/categories'),
    // Reference data: changes when an administrator edits it, not per visit.
    staleTime: 10 * 60_000,
  });
  const index = React.useMemo(
    () => (query.data ? buildTaxonomyIndex(query.data) : null),
    [query.data],
  );
  return { index, isLoading: query.isLoading, error: query.error };
}

const EMPTY_COMMERCIAL: CommerceCommercialFields = {
  quantity: null,
  unit: null,
  pricePerUnit: null,
  stock: null,
  pickupCity: null,
  deliveryCity: null,
  requiredWithinDays: null,
};

export interface CommerceEntry {
  text: string;
  setText: (next: string) => void;
  /** Ask Saarthi what the text says. Corrections already made are kept. */
  /** Read `override` instead of the current text — for a line handed in from elsewhere. */
  interpret: (override?: string) => void;
  interpreting: boolean;
  /** True once the text has been read at least once, successfully or not. */
  interpreted: boolean;
  /** The engine could not be reached; the user picks a category by hand. */
  failed: boolean;
  confidence: CommerceConfidence | null;
  alternatives: CommerceInterpretation['alternatives'];
  commercial: CommerceCommercialFields;

  categoryId: string | null;
  chooseCategory: (categoryId: string) => void;
  fields: CommerceAttributeDefinition[];
  attributes: CommerceAttributeValues;
  setAttribute: (key: string, value: CommerceAttributeValue | undefined) => void;
  /** Required attributes that still have no value. */
  missingAttributes: string[];
  /** The category's breadcrumb, ready to render. */
  path: string[];
  isFallback: boolean;
}

/**
 * State for one "What are you selling?" / "What do you need?" entry.
 *
 * The user stays in control: a category they chose and every detail they
 * typed are sent back as `locked` on the next read, and the server never
 * overrides a locked value — so re-reading edited text refines the answer
 * without undoing a correction.
 */
export function useCommerceEntry(
  scope: CommerceRecordScope,
  index: CommerceTaxonomyIndex | null,
  options: { onInterpreted?: (result: CommerceInterpretation) => void } = {},
): CommerceEntry {
  const [text, setText] = React.useState('');
  const [result, setResult] = React.useState<CommerceInterpretation | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [categoryLocked, setCategoryLocked] = React.useState(false);
  const [attributes, setAttributes] = React.useState<CommerceAttributeValues>({});
  const [lockedKeys, setLockedKeys] = React.useState<ReadonlySet<string>>(new Set());

  const lockedAttributes = React.useMemo(
    () => Object.fromEntries(Object.entries(attributes).filter(([key]) => lockedKeys.has(key))),
    [attributes, lockedKeys],
  );

  const read = useMutation({
    mutationFn: (value: string) =>
      api.post<CommerceInterpretation>('/commerce/interpret', {
        text: value,
        scope,
        locked: {
          ...(categoryLocked && categoryId ? { categoryId } : {}),
          ...(Object.keys(lockedAttributes).length > 0 ? { attributes: lockedAttributes } : {}),
        },
      }),
    onSuccess: (next) => {
      setFailed(false);
      setResult(next);
      if (!categoryLocked) setCategoryId(next.category?.id ?? null);
      setAttributes({ ...next.attributes, ...lockedAttributes });
      options.onInterpreted?.(next);
    },
    // The engine is an enhancement: when it cannot be reached the form falls
    // back to a manual category choice and still works.
    onError: () => setFailed(true),
  });

  const chooseCategory = (next: string): void => {
    setCategoryId(next);
    setCategoryLocked(true);
  };

  const setAttribute = (key: string, value: CommerceAttributeValue | undefined): void => {
    setAttributes((previous) => {
      const copy = { ...previous };
      if (value === undefined || value === '') delete copy[key];
      else copy[key] = value;
      return copy;
    });
    setLockedKeys((previous) => new Set(previous).add(key));
  };

  const fields = React.useMemo(
    () => (index && categoryId ? effectiveAttributes(index, categoryId, scope) : []),
    [index, categoryId, scope],
  );
  const ref = index && categoryId ? categoryRef(index, categoryId) : null;

  return {
    text,
    setText,
    interpret: (override?: string) => {
      if (override !== undefined) setText(override);
      read.mutate(override ?? text);
    },
    interpreting: read.isPending,
    interpreted: result !== null || failed,
    failed,
    confidence: categoryLocked ? 'HIGH' : (result?.confidence ?? null),
    alternatives: categoryLocked ? [] : (result?.alternatives ?? []),
    commercial: result?.commercial ?? EMPTY_COMMERCIAL,
    categoryId,
    chooseCategory,
    fields,
    attributes,
    setAttribute,
    missingAttributes: fields
      .filter((field) => field.required && attributes[field.key] === undefined)
      .map((field) => field.key),
    path: ref?.path.map((node) => node.name) ?? [],
    isFallback: ref?.isFallback ?? false,
  };
}

/** Only the values that belong to the chosen category's schema. */
export function attributesForSave(entry: CommerceEntry): CommerceAttributeValues {
  return Object.fromEntries(
    entry.fields
      .filter((field) => entry.attributes[field.key] !== undefined)
      .map((field) => [field.key, entry.attributes[field.key]!]),
  );
}
