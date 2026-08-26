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

// ---------------------------------------------------------------------------
// Tool calling
// ---------------------------------------------------------------------------

/**
 * The tool-calling half of the contract.
 *
 * The older `chat`/`summarize`/`recommend` methods hand the model a context
 * object assembled in advance. That works, but it forces the permission layer
 * to guess what the question will need, and it sends far more than any one
 * answer uses.
 *
 * Tool calling inverts it: the model asks for what it needs, one authorised
 * call at a time. The important property is unchanged — the model still never
 * reaches storage, because every tool call is executed by Saarthi against the
 * caller's own permissions, and the model only ever sees the result.
 */

export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface AiToolInvocation {
  /** Provider-assigned id, echoed back with the result. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiTurn {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  /** Present on an assistant turn that asked for data. */
  toolCalls?: AiToolInvocation[];
  /** Present on a tool turn: which invocation this answers. */
  toolCallId?: string;
  toolName?: string;
  toolResult?: unknown;
}

export interface AiGeneration {
  /** Final prose, or `null` when the model only asked for tools this round. */
  content: string | null;
  toolCalls: AiToolInvocation[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** Why the model stopped: useful for spotting truncation. */
  finishReason: 'stop' | 'tool_calls' | 'length' | 'other';
}

export interface AiGenerateInput {
  system: string;
  turns: AiTurn[];
  tools: AiToolSpec[];
}

/** Implemented by providers that support tool calling. */
export interface ToolCapableAiProvider extends AiProvider {
  readonly supportsTools: true;
  generate(input: AiGenerateInput): Promise<AiGeneration>;
}

export function supportsTools(provider: AiProvider): provider is ToolCapableAiProvider {
  return (
    (provider as ToolCapableAiProvider).supportsTools === true &&
    typeof (provider as ToolCapableAiProvider).generate === 'function'
  );
}
