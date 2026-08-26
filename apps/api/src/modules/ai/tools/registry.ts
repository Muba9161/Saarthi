import { createHash } from 'node:crypto';
import { hasAnyPermission } from '@saarthi/shared';
import { config } from '../../../config/env';
import { cache } from '../../../infra/cache';
import { logger } from '../../../lib/logger';
import { hasFeature } from '../../../server/guards';
import type { AuthContext } from '../../../auth/context';
import { FLEET_TOOLS } from './fleet.tools';
import { VEHICLE_TOOLS } from './vehicle.tools';
import { FINANCE_TOOLS } from './finance.tools';
import { SERVICE_TOOLS } from './service.tools';
import { DRIVER_TOOLS } from './driver.tools';
import { COST_TOOLS } from './cost.tools';
import { SUBSCRIPTION_TOOLS } from './subscription.tools';
import type { AiTool, RecordedToolCall, ToolResult, ToolSpecification } from './tool.types';

/**
 * The authorised tool registry.
 *
 * Three checks stand between a model asking for something and Saarthi
 * answering, and they run in this order for a reason:
 *
 *   1. **Does this tool exist?** An unknown name is refused rather than
 *      guessed at. Models occasionally invent plausible tool names.
 *   2. **May this caller use it?** Permissions and plan entitlement, checked
 *      against the *human's* session — never against anything the model said.
 *      A tool the caller cannot use is not offered at all, so the model cannot
 *      describe a capability the person does not have.
 *   3. **Are the arguments valid?** Parsed with the tool's own schema, so a
 *      hallucinated vehicle id fails validation instead of reaching a query.
 *
 * Only then does the tool run, always scoped to the caller's organization.
 */

const toolLogger = logger.child({ module: 'ai:tools' });

const ALL_TOOLS: AiTool[] = [
  ...FLEET_TOOLS,
  ...VEHICLE_TOOLS,
  ...SERVICE_TOOLS,
  ...FINANCE_TOOLS,
  ...DRIVER_TOOLS,
  ...COST_TOOLS,
  ...SUBSCRIPTION_TOOLS,
] as AiTool[];

const BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

/** Every registered tool, regardless of who may call it. */
export function allTools(): AiTool[] {
  return ALL_TOOLS;
}

/**
 * The tools this caller may actually use.
 *
 * This is the list handed to the model. Filtering here rather than at call time
 * matters: a model told about `get_vehicle_loan_summary` will offer to check
 * EMIs, and a dispatcher who cannot see finance would then be refused after
 * being promised an answer.
 */
export function authorizedTools(auth: AuthContext): AiTool[] {
  return ALL_TOOLS.filter((tool) => {
    if (tool.permissions.length > 0 && !hasAnyPermission(auth.permissions, tool.permissions)) {
      return false;
    }
    if (tool.feature && !hasFeature(auth, tool.feature)) return false;
    return true;
  });
}

/** Convert a tool's Zod schema into the JSON Schema shape models expect. */
export function toolSpecifications(tools: AiTool[]): ToolSpecification[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.input),
  }));
}

/**
 * A deliberately small Zod-to-JSON-Schema conversion.
 *
 * Tool inputs in this registry are flat objects of optional scalars — an id, a
 * day count, a status filter — so a full converter would be a dependency
 * carried for one shape. Anything it cannot express degrades to a permissive
 * object, and the Zod schema still validates for real before execution, so an
 * imprecise description can cost a retry but never a bad query.
 */
function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  const definition = schema as {
    _def?: { typeName?: string; shape?: () => Record<string, unknown> };
  };

  if (definition?._def?.typeName !== 'ZodObject' || !definition._def.shape) {
    return { type: 'object', properties: {}, additionalProperties: true };
  }

  const shape = definition._def.shape();
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const { schema: fieldSchema, optional } = describeField(value);
    properties[key] = fieldSchema;
    if (!optional) required.push(key);
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function describeField(field: unknown): {
  schema: Record<string, unknown>;
  optional: boolean;
} {
  let current = field as {
    _def?: {
      typeName?: string;
      innerType?: unknown;
      values?: string[];
      description?: string;
      defaultValue?: () => unknown;
    };
    description?: string;
  };
  let optional = false;
  let description: string | undefined = current?.description;

  // Unwrap optional/default/nullable wrappers to reach the real type.
  for (let depth = 0; depth < 6; depth += 1) {
    const typeName = current?._def?.typeName;
    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodDefault' ||
      typeName === 'ZodNullable'
    ) {
      optional = true;
      current = current._def?.innerType as typeof current;
      description = description ?? current?.description;
      continue;
    }
    break;
  }

  const typeName = current?._def?.typeName;
  const base: Record<string, unknown> = description ? { description } : {};

  switch (typeName) {
    case 'ZodString':
      return { schema: { ...base, type: 'string' }, optional };
    case 'ZodNumber':
      return { schema: { ...base, type: 'number' }, optional };
    case 'ZodBoolean':
      return { schema: { ...base, type: 'boolean' }, optional };
    case 'ZodEnum':
      return {
        schema: { ...base, type: 'string', enum: current?._def?.values ?? [] },
        optional,
      };
    case 'ZodArray':
      return { schema: { ...base, type: 'array', items: { type: 'string' } }, optional };
    default:
      return { schema: { ...base, type: 'string' }, optional };
  }
}

/**
 * Cache key for a tool result.
 *
 * The authorisation scope is *inside* the key, not alongside it. Two callers
 * with different permissions can ask the same question and legitimately deserve
 * different answers, and a cache that ignored that would hand one tenant's
 * figures to another. That is the single worst bug this module could have, so
 * the key is built from the tenant, the caller and their permission set.
 */
function cacheKeyFor(
  auth: AuthContext,
  organizationId: string,
  toolName: string,
  input: unknown,
): string {
  const scope = createHash('sha256')
    .update(
      JSON.stringify({
        organizationId,
        userId: auth.user.id,
        // Permissions, not roles: a grant added mid-session must change the key.
        permissions: [...auth.permissions].sort(),
        features: [...(auth.subscription?.features ?? [])].sort(),
        input,
      }),
    )
    .digest('hex')
    .slice(0, 24);

  return `saarthi:${config.env}:ai:tool:${toolName}:${scope}`;
}

export interface ToolExecution {
  result: ToolResult | null;
  record: RecordedToolCall;
}

/**
 * Run one tool on behalf of a caller.
 *
 * Never throws for an ordinary failure: an unknown tool, a refused permission
 * or a bad argument comes back as a recorded error the model can read and
 * respond to honestly. A model that receives "you are not permitted to see
 * loan data" can tell the user that; one that receives an exception produces a
 * blank screen.
 */
export async function executeTool(
  auth: AuthContext,
  organizationId: string,
  toolName: string,
  rawInput: unknown,
): Promise<ToolExecution> {
  const startedAt = Date.now();

  const fail = (error: string): ToolExecution => ({
    result: null,
    record: {
      tool: toolName,
      arguments: (rawInput as Record<string, unknown>) ?? {},
      basis: null,
      recordCount: 0,
      references: [],
      caveats: [],
      durationMs: Date.now() - startedAt,
      cached: false,
      error,
    },
  });

  const tool = BY_NAME.get(toolName);
  if (!tool) return fail(`No such tool: ${toolName}.`);

  if (tool.permissions.length > 0 && !hasAnyPermission(auth.permissions, tool.permissions)) {
    // Phrased for the model to relay verbatim. It is a true and useful answer.
    return fail('You do not have permission to see this information.');
  }
  if (tool.feature && !hasFeature(auth, tool.feature)) {
    return fail('This information is not included in your current plan.');
  }

  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      `Invalid arguments${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}.`,
    );
  }

  const key = cacheKeyFor(auth, organizationId, toolName, parsed.data);

  if (tool.cacheTtlSeconds > 0) {
    const hit = await cache.get<ToolResult>(key);
    if (hit) {
      return {
        result: hit,
        record: {
          tool: toolName,
          arguments: parsed.data as Record<string, unknown>,
          basis: hit.basis,
          recordCount: hit.recordCount,
          references: hit.references,
          caveats: hit.caveats,
          durationMs: Date.now() - startedAt,
          cached: true,
          error: null,
        },
      };
    }
  }

  try {
    const result = await tool.handler({ auth, organizationId }, parsed.data);

    if (tool.cacheTtlSeconds > 0) {
      await cache.set(key, result, tool.cacheTtlSeconds);
    }

    toolLogger.debug(
      { tool: toolName, organizationId, records: result.recordCount, ms: Date.now() - startedAt },
      'Tool executed',
    );

    return {
      result,
      record: {
        tool: toolName,
        arguments: parsed.data as Record<string, unknown>,
        basis: result.basis,
        recordCount: result.recordCount,
        references: result.references,
        caveats: result.caveats,
        durationMs: Date.now() - startedAt,
        cached: false,
        error: null,
      },
    };
  } catch (error) {
    // A tool failing is not an AI failure. The model is told, and answers
    // honestly about what it could not check.
    toolLogger.warn({ err: error, tool: toolName, organizationId }, 'Tool execution failed');
    return fail(
      error instanceof Error ? error.message : 'That information could not be retrieved.',
    );
  }
}

/** Look a tool up without executing it — used by the routes that list them. */
export function findTool(name: string): AiTool | undefined {
  return BY_NAME.get(name);
}
