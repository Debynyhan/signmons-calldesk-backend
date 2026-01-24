import { CommunicationChannel } from "@prisma/client";
import {
  CsrStrategy,
  CsrStrategySelector,
} from "../csr-strategy.selector";

describe("CsrStrategySelector", () => {
  const selector = new CsrStrategySelector();

  it("returns the same strategy for identical inputs", () => {
    const input = {
      channel: CommunicationChannel.VOICE,
      fsmState: "TRIAGE",
      hasConfirmedName: false,
      hasConfirmedAddress: false,
      urgency: false,
      isPaymentRequiredNext: false,
    };

    const first = selector.selectStrategy(input);
    const second = selector.selectStrategy(input);

    expect(first).toBe(second);
  });

  it("uses CONFIRMATION when missing required fields in a collecting state", () => {
    const strategy = selector.selectStrategy({
      channel: CommunicationChannel.VOICE,
      fsmState: "COLLECTING_NAME",
      hasConfirmedName: false,
      hasConfirmedAddress: false,
      urgency: false,
      isPaymentRequiredNext: false,
    });

    expect(strategy).toBe(CsrStrategy.CONFIRMATION);
  });

  it("uses URGENCY_FRAMING when urgency is true", () => {
    const strategy = selector.selectStrategy({
      channel: CommunicationChannel.VOICE,
      fsmState: "TRIAGE",
      hasConfirmedName: false,
      hasConfirmedAddress: false,
      urgency: true,
      isPaymentRequiredNext: false,
    });

    expect(strategy).toBe(CsrStrategy.URGENCY_FRAMING);
  });

  it("uses NEXT_STEP_POSITIONING when confirmed and payment is required next", () => {
    const strategy = selector.selectStrategy({
      channel: CommunicationChannel.VOICE,
      fsmState: "READY_FOR_PAYMENT",
      hasConfirmedName: true,
      hasConfirmedAddress: true,
      urgency: false,
      isPaymentRequiredNext: true,
    });

    expect(strategy).toBe(CsrStrategy.NEXT_STEP_POSITIONING);
  });

  it("uses OPENING on initial turn when no other rule matches", () => {
    const strategy = selector.selectStrategy({
      channel: CommunicationChannel.VOICE,
      fsmState: "TRIAGE",
      hasConfirmedName: false,
      hasConfirmedAddress: false,
      urgency: false,
      isPaymentRequiredNext: false,
    });

    expect(strategy).toBe(CsrStrategy.OPENING);
  });
});
