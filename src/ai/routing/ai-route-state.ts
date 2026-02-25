export const AI_ROUTE_INTENTS = ["BOOKING", "FAQ"] as const;
export type AiRouteIntent = (typeof AI_ROUTE_INTENTS)[number];

export const AI_ROUTE_SOURCE = "AI_TOOL" as const;

export type AiRouteState = {
  intent: AiRouteIntent;
  updatedAt: string;
  source: typeof AI_ROUTE_SOURCE;
};

export function isAiRouteIntent(value: unknown): value is AiRouteIntent {
  return value === "BOOKING" || value === "FAQ";
}

export function getAiRouteIntentFromCollectedData(
  collectedData: unknown,
): AiRouteIntent | null {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const route = (collectedData as Record<string, unknown>).aiRoute;
  if (!route || typeof route !== "object") {
    return null;
  }
  const intent = (route as Record<string, unknown>).intent;
  return isAiRouteIntent(intent) ? intent : null;
}

export function buildAiRouteState(
  intent: AiRouteIntent,
  now = new Date(),
): AiRouteState {
  return {
    intent,
    updatedAt: now.toISOString(),
    source: AI_ROUTE_SOURCE,
  };
}
