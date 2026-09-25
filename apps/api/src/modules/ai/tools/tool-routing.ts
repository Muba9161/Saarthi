import type { AiTool } from './tool.types';

/**
 * Hand the model only the tools a question is about.
 *
 * Every tool description is sent with every model call, and a copilot answer
 * can take several calls. Offering all of them to "which EMIs are due?" pays
 * for vehicle telemetry, driver scoring and SOS descriptions nobody asked
 * about — thousands of tokens a question, against a provider that meters
 * tokens per minute. So a question is matched to the tool groups it mentions,
 * in English or Hindi/Hinglish, plus a small core that is always present.
 *
 * When nothing matches, every tool is offered: a vague question costs more,
 * but is never left without the tool that would have answered it.
 */

type Category = AiTool['category'];

/** Always offered: the fleet overview and Mitra's own guide and drafts. */
const CORE: readonly Category[] = ['fleet', 'assistant'];

const KEYWORDS: Record<Exclude<Category, 'fleet' | 'assistant'>, RegExp> = {
  vehicle:
    /\b(vehicles?|trucks?|gaadi|gadi|gaadiyan|rc|registration|odometer|km|mileage|engine|telemetry|obd|location|where|kahan|kidhar|tracker|gps|speed|idle|parked)\b/i,
  service:
    /\b(service|servicing|maintenance|repair|workshop|mechanic|tyres?|tires?|breakdown|kharab)\b/i,
  finance:
    /\b(emi|emis|loan|loans|finance|installments?|kist|kisht|interest|bank|payment|dues?)\b/i,
  driver: /\b(drivers?|chalak|licen[cs]e|dl|score|behaviour|behavior|harsh)\b/i,
  cost: /\b(cost|costs|fuel|diesel|petrol|spend|spent|expense|expenses|kharcha|kharch|toll|fastag|profit|margin|budget)\b/i,
  subscription:
    /\b(plan|subscription|top-?ups?|capacity|billing|upgrade|trial|renew|add (a |another )?(vehicle|truck)|limit)\b/i,
  safety:
    /\b(sos|alerts?|accident|emergency|overspeed|overspeeding|safety|danger|incident|madad|help me)\b/i,
};

/** The categories a question (and the one before it) is about. */
export function categoriesFor(texts: string[]): Set<Category> {
  const matched = new Set<Category>();
  for (const text of texts) {
    for (const [category, pattern] of Object.entries(KEYWORDS) as [Category, RegExp][]) {
      if (pattern.test(text)) matched.add(category);
    }
  }
  return matched;
}

export function routeTools(tools: AiTool[], texts: string[]): AiTool[] {
  const matched = categoriesFor(texts);
  if (matched.size === 0) return tools;
  return tools.filter((tool) => CORE.includes(tool.category) || matched.has(tool.category));
}
