import {
  AI_ROUTE_INTENTS,
  AI_ROUTE_SOURCE,
  buildAiRouteState,
  getAiRouteIntentFromCollectedData,
  isAiRouteIntent,
} from "../ai-route-state";

describe("ai-route-state", () => {
  it("exposes the supported route intents", () => {
    expect(AI_ROUTE_INTENTS).toEqual(["BOOKING", "FAQ"]);
  });

  it("validates supported route intents", () => {
    expect(isAiRouteIntent("BOOKING")).toBe(true);
    expect(isAiRouteIntent("FAQ")).toBe(true);
    expect(isAiRouteIntent("SALES")).toBe(false);
    expect(isAiRouteIntent(null)).toBe(false);
    expect(isAiRouteIntent(123)).toBe(false);
  });

  it("extracts route intent from collectedData.aiRoute.intent", () => {
    expect(
      getAiRouteIntentFromCollectedData({
        aiRoute: { intent: "BOOKING" },
      }),
    ).toBe("BOOKING");
    expect(
      getAiRouteIntentFromCollectedData({
        aiRoute: { intent: "FAQ", updatedAt: "2026-01-01T00:00:00.000Z" },
      }),
    ).toBe("FAQ");
  });

  it("returns null for invalid or missing route metadata", () => {
    expect(getAiRouteIntentFromCollectedData(null)).toBeNull();
    expect(getAiRouteIntentFromCollectedData(undefined)).toBeNull();
    expect(getAiRouteIntentFromCollectedData("bad")).toBeNull();
    expect(getAiRouteIntentFromCollectedData({})).toBeNull();
    expect(getAiRouteIntentFromCollectedData({ aiRoute: null })).toBeNull();
    expect(getAiRouteIntentFromCollectedData({ aiRoute: "bad" })).toBeNull();
    expect(
      getAiRouteIntentFromCollectedData({
        aiRoute: { intent: "SALES" },
      }),
    ).toBeNull();
    expect(
      getAiRouteIntentFromCollectedData({
        aiRoute: { intent: 123 },
      }),
    ).toBeNull();
  });

  it("builds route state with source and ISO timestamp", () => {
    const now = new Date("2026-02-25T12:34:56.789Z");

    expect(buildAiRouteState("BOOKING", now)).toEqual({
      intent: "BOOKING",
      updatedAt: "2026-02-25T12:34:56.789Z",
      source: AI_ROUTE_SOURCE,
    });
  });

  it("uses AI_TOOL as the route source constant", () => {
    expect(AI_ROUTE_SOURCE).toBe("AI_TOOL");
  });
});
