import { ChatOpenAI } from "@langchain/openai";
import type { AssistantHistoryTurn } from "../shared/types";
import { envValue } from "./lib/env";

/** Model identifier required by the hackathon brief; overridable by env. */
export const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_MAX_STEPS = 4;
const MODEL_TIMEOUT_MS = 25_000;

export interface AgentConfig {
  enabled: boolean;
  apiKey: string | null;
  baseURL: string | null;
  model: string;
  fallback: boolean;
  maxSteps: number;
}

function flag(value: string | null, fallbackValue: boolean): boolean {
  if (value === null) return fallbackValue;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallbackValue;
}

function int(value: string | null, fallbackValue: number, min: number, max: number): number {
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Read once per request so a config edit or test override takes effect. */
export function getAgentConfig(): AgentConfig {
  return {
    enabled: flag(envValue("AI_AGENT_ENABLED"), false),
    // `LLM_API_KEY` is the older name kept in `.env.example`; both work.
    apiKey: envValue("OPENAI_API_KEY") ?? envValue("LLM_API_KEY"),
    baseURL: envValue("OPENAI_BASE_URL"),
    model: envValue("OPENAI_MODEL") ?? DEFAULT_MODEL,
    fallback: flag(envValue("AI_AGENT_FALLBACK_TO_RULES"), true),
    maxSteps: int(envValue("AI_AGENT_MAX_STEPS"), DEFAULT_MAX_STEPS, 1, 8),
  };
}

export function agentConfigured(config: AgentConfig = getAgentConfig()): boolean {
  return config.enabled && Boolean(config.apiKey);
}

export function createChatModel(config: AgentConfig, apiKey = config.apiKey): ChatOpenAI {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new ChatOpenAI({
    model: config.model,
    apiKey,
    useResponsesApi: true,
    reasoning: { effort: "low" },
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: 1,
    configuration: config.baseURL ? { baseURL: config.baseURL } : undefined,
  });
}

const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 320;

/** Bounded, validated history: enough for follow-ups, never the whole thread. */
export function normalizeHistory(history: unknown): AssistantHistoryTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (turn): turn is AssistantHistoryTurn =>
        Boolean(turn) &&
        typeof turn === "object" &&
        ((turn as AssistantHistoryTurn).role === "user" ||
          (turn as AssistantHistoryTurn).role === "assistant") &&
        typeof (turn as AssistantHistoryTurn).text === "string",
    )
    .map((turn) => ({ role: turn.role, text: turn.text.trim().slice(0, MAX_HISTORY_CHARS) }))
    .filter((turn) => turn.text.length > 0)
    .slice(-MAX_HISTORY_TURNS);
}

export { MAX_HISTORY_TURNS, MAX_HISTORY_CHARS };
