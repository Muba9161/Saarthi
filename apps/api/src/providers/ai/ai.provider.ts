/**
 * AI provider abstraction.
 *
 * Business code never talks to a model vendor directly: it assembles an
 * authorised, minimised context object and asks the provider a typed question.
 * Swapping the development provider for a hosted model is a configuration
 * change, and the permission boundary stays exactly where it is.
 */

export interface AiFact {
  /** Stable key so the UI can deep-link back to the underlying record. */
  reference?: { type: string; id: string; label: string };
  statement: string;
  /** Where the number came from — never blur these together. */
  basis: 'recorded' | 'calculated' | 'predicted';
}

export interface AiContext {
  /** Human-readable description of the tenant, e.g. "Fleet of 8 trucks". */
  scope: string;
  organizationId: string | null;
  /** The caller's role, so the provider can pitch the answer appropriately. */
  role: string;
  /** Structured, already-authorised data. Nothing here is fetched by the model. */
  facts: AiFact[];
  /** Aggregate figures the model may quote verbatim. */
  metrics: Record<string, number | string | null>;
  generatedAt: string;
}

export interface AiMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiAnswer {
  content: string;
  /** Records the answer drew on, for the "sources" panel. */
  references: { type: string; id: string; label: string }[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface AiRecommendationItem {
  title: string;
  detail: string;
  /** Why the recommendation was made — mandatory, never optional. */
  reasoning: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  reference?: { type: string; id: string; label: string };
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Conversational Q&A grounded in the supplied context. */
  chat(
    question: string,
    context: AiContext,
    history?: AiMessageInput[],
  ): Promise<AiAnswer>;
  /** Narrative summary of a context (fleet status, trip, document set). */
  summarize(context: AiContext, focus: string): Promise<AiAnswer>;
  /** Ranked, reasoned suggestions for a decision. */
  recommend(context: AiContext, kind: string): Promise<AiRecommendationItem[]>;
}
