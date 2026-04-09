import { Inject, Injectable } from "@nestjs/common";
import type { TenantFeePolicy } from "@prisma/client";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";

@Injectable()
export class VoiceHandoffPolicyService {
  constructor(
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
  ) {}

  async getTenantFeePolicySafe(tenantId: string): Promise<TenantFeePolicy | null> {
    try {
      return await this.tenantsService.getTenantFeePolicy(tenantId);
    } catch {
      return null;
    }
  }

  getTenantFeeConfig(policy: TenantFeePolicy | null): {
    serviceFee: number | null;
    emergencyFee: number | null;
    creditWindowHours: number;
  } {
    if (!policy) {
      return {
        serviceFee: null,
        emergencyFee: null,
        creditWindowHours: 24,
      };
    }
    const creditWindowHours =
      typeof policy.creditWindowHours === "number" && policy.creditWindowHours > 0
        ? policy.creditWindowHours
        : 24;
    const emergencyFee =
      typeof policy.emergencyFeeCents === "number" && policy.emergencyFeeCents > 0
        ? policy.emergencyFeeCents / 100
        : null;
    return {
      serviceFee: policy.serviceFeeCents / 100,
      emergencyFee,
      creditWindowHours,
    };
  }

  formatFeeAmount(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
  }

  buildSmsHandoffMessage(callerFirstName?: string): string {
    const thanks = callerFirstName ? `Thanks, ${callerFirstName}.` : "Perfect.";
    return `${thanks} I'm texting you now to confirm your details. We'll be in touch shortly.`;
  }

  buildSmsHandoffMessageWithFees(params: {
    feePolicy: TenantFeePolicy | null;
    isEmergency: boolean;
    callerFirstName?: string;
  }): string {
    const { serviceFee, emergencyFee, creditWindowHours } = this.getTenantFeeConfig(
      params.feePolicy,
    );
    const creditWindowLabel =
      creditWindowHours === 1 ? "1 hour" : `${creditWindowHours} hours`;
    const serviceLine =
      typeof serviceFee === "number"
        ? `The service fee is ${this.formatFeeAmount(
            serviceFee,
          )}, and it's credited toward repairs if you approve within ${creditWindowLabel}.`
        : `A service fee applies, and it's credited toward repairs if you approve within ${creditWindowLabel}.`;
    const emergencyLine = params.isEmergency
      ? typeof emergencyFee === "number"
        ? `Because this is urgent, there's an additional ${this.formatFeeAmount(
            emergencyFee,
          )} emergency fee. The emergency fee is not credited.`
        : "Because this is urgent, an additional emergency fee applies. The emergency fee is not credited."
      : "";
    const approvalTarget = params.isEmergency ? "the fees" : "the service fee";
    const opener = params.callerFirstName
      ? `Great, ${params.callerFirstName} —`
      : "Great —";
    const smsLine = `I'm texting you now to confirm your details and approve ${approvalTarget}. We'll be in touch shortly.`;
    const feeBlock = emergencyLine ? `${serviceLine} ${emergencyLine}` : serviceLine;
    return `${opener} ${feeBlock} ${smsLine}`.trim();
  }

  buildSmsHandoffMessageForContext(params: {
    feePolicy: TenantFeePolicy | null;
    includeFees: boolean;
    isEmergency: boolean;
    callerFirstName?: string;
  }): string {
    if (!params.includeFees) {
      return this.buildSmsHandoffMessage(params.callerFirstName);
    }
    return this.buildSmsHandoffMessageWithFees({
      feePolicy: params.feePolicy,
      isEmergency: params.isEmergency,
      callerFirstName: params.callerFirstName,
    });
  }

  async resolveSmsHandoffClosingMessage(params: {
    tenantId: string;
    isEmergency: boolean;
    messageOverride?: string;
    callerFirstName?: string;
  }): Promise<string> {
    const feePolicy = await this.getTenantFeePolicySafe(params.tenantId);
    const fallbackMessage = this.buildSmsHandoffMessageWithFees({
      feePolicy,
      isEmergency: params.isEmergency,
      callerFirstName: params.callerFirstName,
    });
    const override = params.messageOverride?.trim();
    if (!override) {
      return fallbackMessage;
    }
    const hasFeeLanguage =
      /\b(service fee|emergency fee|credited toward repairs|fee applies|approve (?:the )?fees|approve (?:the )?service fee)\b/i.test(
        override,
      );
    const hasTextLanguage = /\btext(?:ing)? you\b/i.test(override);
    return hasFeeLanguage && hasTextLanguage ? override : fallbackMessage;
  }
}
