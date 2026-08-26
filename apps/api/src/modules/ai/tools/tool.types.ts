import type { ZodTypeAny } from 'zod';
import type { Feature, Permission } from '@saarthi/shared';
import type { AuthContext } from '../../../auth/context';

/**
 * The authorised tool contract.
 *
 * A tool is the *only* way the AI layer reaches Saarthi data. That single rule
 * is what makes the whole thing safe to point a language model at: the model
 * emits a tool name and some arguments, and this layer decides — from the
 * caller's permissions, their tenant and their plan — whether that call
 * happens at all. The model never sees a query, a connection or another
 * tenant's row, because it never touches storage.
 *
 * Every tool answers with a labelled `basis`. A fleet owner reading "three
 * vehicles need service" deserves to know whether that is a stored fact, a rule
 * Saarthi applied, or the model's own inference — and the model cannot be
 * trusted to keep that distinction on its own, so the data carries it.
 */

/** What kind of statement a value is. Travels with the result, always. */
export const ResultBasis = {
  /** Recorded in Saarthi. A number someone entered or a device reported. */
  SOURCE_DATA: 'SOURCE_DATA',
  /** Computed by deterministic Saarthi logic from source data. */
  RULE_RESULT: 'RULE_RESULT',
  /** Retrieved from an external provider. An assertion, not a verified fact. */
  PROVIDER_REPORTED: 'PROVIDER_REPORTED',
} as const;
export type ResultBasis = (typeof ResultBasis)[keyof typeof ResultBasis];

export interface ToolReference {
  type: string;
  id: string;
  label: string;
}

export interface ToolResult<T = unknown> {
  data: T;
  basis: ResultBasis;
  /** Records this answer drew on, for the sources panel and the audit trail. */
  references: ToolReference[];
  /**
   * What the tool could not see.
   *
   * The most dangerous AI answer is a confident one built on a partial query.
   * A tool that had to cap, filter or skip anything says so here, and the
   * caller is instructed to pass it on rather than round it off.
   */
  caveats: string[];
  /** How many records the figures were computed from. */
  recordCount: number;
}

export interface ToolContext {
  auth: AuthContext;
  organizationId: string;
}

export interface AiTool<TInput = unknown, TOutput = unknown> {
  name: string;
  /** Shown to the model. Written for a reader who cannot see the code. */
  description: string;
  /** Zod schema — validates the model's arguments before anything executes. */
  input: ZodTypeAny;
  /**
   * Permissions the caller must hold. A tool the caller cannot use is not
   * merely refused at call time: it is never offered to the model, so it
   * cannot describe capabilities the person does not have.
   */
  permissions: Permission[];
  /** Plan entitlement required, when the underlying feature is gated. */
  feature?: Feature;
  category:
    | 'fleet'
    | 'vehicle'
    | 'service'
    | 'finance'
    | 'driver'
    | 'cost'
    | 'subscription'
    | 'safety';
  /**
   * Seconds a result may be reused within one authorisation scope.
   *
   * `0` disables caching. Anything holding money or a live position stays low
   * or off — an operator who has just recorded a payment must not be told by
   * the assistant that it is still outstanding.
   */
  cacheTtlSeconds: number;
  handler: (context: ToolContext, input: TInput) => Promise<ToolResult<TOutput>>;
}

/** A single tool invocation, as recorded for provenance. */
export interface RecordedToolCall {
  tool: string;
  arguments: Record<string, unknown>;
  basis: ResultBasis | null;
  recordCount: number;
  references: ToolReference[];
  caveats: string[];
  durationMs: number;
  cached: boolean;
  error: string | null;
}

/** The model-facing description of a tool, in JSON Schema form. */
export interface ToolSpecification {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
