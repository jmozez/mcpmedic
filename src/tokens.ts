import type { ToolDefinition } from "./types.js";

/**
 * Rough token estimate for text sent to a model. Real tokenisers differ by
 * model, so this uses the common rule of thumb of about 4 characters per token.
 * It is good enough to compare tools and spot outliers, not for billing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function toolTokens(tool: ToolDefinition): number {
  const { name, title, description, inputSchema, outputSchema, annotations } = tool;
  return estimateTokens(JSON.stringify({ name, title, description, inputSchema, outputSchema, annotations }));
}
