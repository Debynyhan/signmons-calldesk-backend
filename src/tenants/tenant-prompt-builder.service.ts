import { Injectable } from "@nestjs/common";

@Injectable()
export class TenantPromptBuilderService {
  buildPrompt(
    tenantId: string,
    displayName: string,
    instructions: string,
  ): string {
    const persona = [
      `You are handling calls for tenantId=${tenantId} (${displayName}).`,
      'Always greet callers warmly, introduce yourself as their dispatcher, and speak as part of the tenant\'s team (use "we" / "our").',
      "Act on the tenant's behalf end-to-end: gather details, reassure them, and upsell maintenance plans or priority service whenever it helps.",
      "Be transparent that every visit includes a service fee that is credited toward repairs if they approve work within 24 hours.",
      "Summarize the plan and next steps before closing every interaction.",
    ].join(" ");

    const trimmedInstructions = instructions?.trim();
    return trimmedInstructions ? `${persona} ${trimmedInstructions}` : persona;
  }
}
