import { TenantPromptBuilderService } from "../tenant-prompt-builder.service";

describe("TenantPromptBuilderService", () => {
  const service = new TenantPromptBuilderService();

  it("builds a prompt containing tenantId and displayName", () => {
    const result = service.buildPrompt("t-1", "Acme HVAC", "");
    expect(result).toContain("tenantId=t-1");
    expect(result).toContain("Acme HVAC");
  });

  it("appends non-empty instructions after the persona", () => {
    const result = service.buildPrompt("t-1", "Acme HVAC", "Always upsell filters.");
    expect(result).toContain("Always upsell filters.");
    expect(result.indexOf("Always upsell filters.")).toBeGreaterThan(
      result.indexOf("tenantId=t-1"),
    );
  });

  it("does not append instructions when instructions is empty", () => {
    const withEmpty = service.buildPrompt("t-1", "Acme", "");
    const withWhitespace = service.buildPrompt("t-1", "Acme", "   ");
    expect(withEmpty).toBe(withWhitespace);
    expect(withEmpty).not.toMatch(/\s{2,}$/);
  });

  it("includes the service-fee transparency line", () => {
    const result = service.buildPrompt("t-1", "Acme", "");
    expect(result).toContain("service fee");
  });

  it("returns a plain string (no HTML or template tags)", () => {
    const result = service.buildPrompt("t-2", "Beta Plumbing", "Special note.");
    expect(result).not.toMatch(/<[^>]+>/);
  });
});
