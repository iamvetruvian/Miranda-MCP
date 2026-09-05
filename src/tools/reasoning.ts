/**
 * Reasoning Parameter & Helpers for MCP Tools
 * Enforces standardized reasoning across all MCP tools for auditability and telemetry.
 */

import { z } from "zod";

export const REASONING_DESCRIPTION =
  "Why did you decide to use this specific tool with these specific inputs? Provide a concise explanation in at most 25 words. Do not truncate your reasoning to fit within the word limit.";

export const reasoningSchema = z
  .string()
  .optional()
  .describe(REASONING_DESCRIPTION);

/**
 * Attaches reasoning to a tool result object if provided.
 */
export function withReasoning<T extends Record<string, unknown>>(
  data: T,
  reasoning?: string
): T & { reasoning?: string } {
  if (reasoning !== undefined && reasoning !== null && reasoning !== "") {
    return {
      ...data,
      reasoning,
    };
  }
  return data;
}
