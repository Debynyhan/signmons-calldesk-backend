import { Injectable } from "@nestjs/common";
import { CommunicationChannel } from "@prisma/client";

export enum CsrStrategy {
  OPENING = "OPENING",
  EMPATHY = "EMPATHY",
  CONFIRMATION = "CONFIRMATION",
  URGENCY_FRAMING = "URGENCY_FRAMING",
  NEXT_STEP_POSITIONING = "NEXT_STEP_POSITIONING",
}

export type CsrStrategyInput = {
  channel: CommunicationChannel;
  fsmState: string | null;
  hasConfirmedName: boolean;
  hasConfirmedAddress: boolean;
  urgency: boolean;
  isPaymentRequiredNext: boolean;
};

@Injectable()
export class CsrStrategySelector {
  selectStrategy(input: CsrStrategyInput): CsrStrategy {
    const state = (input.fsmState ?? "").trim().toUpperCase();
    const missingRequired = !(input.hasConfirmedName && input.hasConfirmedAddress);
    const isCollecting =
      state.includes("CONFIRM") ||
      state.includes("COLLECT") ||
      state.includes("NAME") ||
      state.includes("ADDRESS");
    const isInitial = !state || state === "TRIAGE" || state === "OPENING";

    if (isCollecting && missingRequired) {
      return CsrStrategy.CONFIRMATION;
    }
    if (input.urgency) {
      return CsrStrategy.URGENCY_FRAMING;
    }
    if (!missingRequired && input.isPaymentRequiredNext) {
      return CsrStrategy.NEXT_STEP_POSITIONING;
    }
    if (isInitial) {
      return CsrStrategy.OPENING;
    }
    return CsrStrategy.EMPATHY;
  }
}
