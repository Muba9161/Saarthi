import {
  type CommerceInterpretation,
  type CommerceLockedValues,
  type CommerceTaxonomyIndex,
  type InterpretCommerceInput,
  interpretCommerceText,
  isCategoryActive,
} from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { suggestCategory } from './commerce-ai.service';
import { loadTaxonomy } from './taxonomy.service';

/**
 * One line of text → a structured, schema-valid interpretation.
 *
 *   text → taxonomy match ─┬─ confident → done, no AI
 *                          └─ unsure    → AI suggestion → validated → merged
 *
 * The result is a proposal. Nothing is stored here: the seller or customer
 * reviews it, corrects it, and the save endpoint validates it again.
 */

/** A locked category that has since been deactivated is dropped, not trusted. */
function usableLocks(
  index: CommerceTaxonomyIndex,
  locked: InterpretCommerceInput['locked'],
): CommerceLockedValues | undefined {
  if (!locked) return undefined;
  return {
    ...(locked.categoryId && isCategoryActive(index, locked.categoryId)
      ? { categoryId: locked.categoryId }
      : {}),
    ...(locked.attributes ? { attributes: locked.attributes } : {}),
  };
}

/** Whether the taxonomy's own answer is weak enough to justify a model call. */
function worthAskingAi(result: CommerceInterpretation): boolean {
  return result.confidence === 'LOW' || result.alternatives.length > 0;
}

export async function interpret(
  auth: AuthContext,
  input: InterpretCommerceInput,
): Promise<CommerceInterpretation> {
  const { index, version } = await loadTaxonomy();
  const locked = usableLocks(index, input.locked);

  const deterministic = interpretCommerceText(index, input.text, input.scope, { locked });
  if (locked?.categoryId || !worthAskingAi(deterministic)) return deterministic;

  const suggested = await suggestCategory(auth, {
    text: input.text,
    scope: input.scope,
    index,
    taxonomyVersion: version,
  });
  if (!suggested) return deterministic;

  return interpretCommerceText(index, input.text, input.scope, { locked, suggested });
}
