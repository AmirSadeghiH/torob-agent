import type { AssistantRequest, AssistantResponse } from "../shared/types";
import { respond as respondWithRules } from "./agent";
import { runShoppingAgent, type AgentDeps } from "./ai-agent";
import { agentConfigured, getAgentConfig } from "./ai-config";
import { getMeta } from "./repo";

/** Provider diagnostics without keys, payloads or stack traces. */
function logSanitized(error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  const status = (error as { status?: unknown }).status;
  const code =
    typeof status === "number"
      ? status
      : typeof (error as { code?: unknown }).code === "string"
        ? ((error as { code: string }).code as string)
        : null;
  console.error(`[ai-agent] run failed (${name}${code === null ? "" : `, ${String(code)}`})`);
}

/**
 * The `/api/assistant` entry point.
 *
 * Preferred path: the LLM agent chooses and runs tools, then writes the Persian
 * reply. Safety net: the original deterministic engine, marked for what it is —
 * a fallback never claims the model answered.
 */
export async function respond(
  request: AssistantRequest,
  deps: AgentDeps = {},
): Promise<AssistantResponse> {
  const started = performance.now();
  const config = deps.config ?? getAgentConfig();
  const origin = request.context?.origin ?? getMeta().default_origin;
  const llmAvailable = Boolean(deps.model) || agentConfigured(config);

  if (llmAvailable) {
    try {
      const run = await runShoppingAgent(
        {
          message: request.message,
          context: request.context,
          origin,
          history: request.history,
        },
        { ...deps, config },
      );
      return {
        reply: run.reply,
        blocks: run.blocks,
        suggestions: run.suggestions,
        context: { ...run.context, origin },
        meta: {
          engine: "llm_agent",
          ms: Math.round(performance.now() - started),
          intent: run.intent,
          tool_calls: run.toolCalls,
          parsed: {},
          model: run.model,
        },
      };
    } catch (error) {
      logSanitized(error);
      if (!config.fallback) {
        throw new Error("assistant agent is unavailable and fallback is disabled");
      }
    }
  }

  const rules = await respondWithRules(request);
  return {
    ...rules,
    meta: {
      ...rules.meta,
      engine: config.enabled ? "rules_fallback" : "rules",
      ms: Math.round(performance.now() - started),
      model: null,
    },
  };
}
