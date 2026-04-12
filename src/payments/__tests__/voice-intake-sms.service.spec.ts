import { VoiceIntakeSmsService } from "../voice-intake-sms.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { LoggingService } from "../../logging/logging.service";
import type { IntakeLinkService } from "../intake-link.service";
import type { IntakeFeeCalculatorService } from "../intake-fee-calculator.service";
import type { SmsService } from "../../sms/sms.service";
import type { VoiceConversationStateService } from "../../voice/voice-conversation-state.service";
import type { AppConfig } from "../../config/app.config";

const buildConfig = (overrides: Partial<AppConfig> = {}): AppConfig =>
  ({
    stripeSecretKey: "sk_test_abc",
    smsIntakeBaseUrl: "https://intake.example.com",
    twilioWebhookBaseUrl: "",
    ...overrides,
  }) as AppConfig;

const buildPrisma = () => ({
  conversation: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
});

const buildLogging = () => ({
  log: jest.fn(),
  warn: jest.fn(),
});

const buildIntakeLinkService = () => ({
  createConversationToken: jest.fn().mockReturnValue({
    token: "tok_1",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }),
  buildIntakeUrl: jest.fn().mockReturnValue("https://intake.example.com/tok_1"),
});

const buildIntakeFeeCalculator = () => ({
  resolveIntakeContext: jest.fn().mockResolvedValue({
    tenantId: "tenant-1",
    conversationId: "conv-1",
    displayName: "ACME HVAC",
    currency: "USD",
    isEmergency: false,
  }),
  computeTotalCents: jest.fn().mockReturnValue(9900),
  formatFeeAmount: jest.fn().mockReturnValue("$99.00"),
});

const buildSmsService = () => ({
  sendMessage: jest.fn().mockResolvedValue("SM_1"),
});

const buildVoiceStateService = () => ({
  promoteNameFromSms: jest.fn().mockResolvedValue(undefined),
  promoteAddressFromSms: jest.fn().mockResolvedValue(undefined),
  updateVoiceIssueCandidate: jest.fn().mockResolvedValue(undefined),
});

const buildService = (
  overrides: {
    config?: Partial<AppConfig>;
    prisma?: ReturnType<typeof buildPrisma>;
    logging?: ReturnType<typeof buildLogging>;
    intakeLink?: ReturnType<typeof buildIntakeLinkService>;
    feeCalc?: ReturnType<typeof buildIntakeFeeCalculator>;
    sms?: ReturnType<typeof buildSmsService>;
    voiceState?: ReturnType<typeof buildVoiceStateService>;
  } = {},
) => {
  const config = buildConfig(overrides.config);
  const prisma = overrides.prisma ?? buildPrisma();
  const logging = overrides.logging ?? buildLogging();
  const intakeLink = overrides.intakeLink ?? buildIntakeLinkService();
  const feeCalc = overrides.feeCalc ?? buildIntakeFeeCalculator();
  const sms = overrides.sms ?? buildSmsService();
  const voiceState = overrides.voiceState ?? buildVoiceStateService();
  return {
    service: new VoiceIntakeSmsService(
      config,
      prisma as unknown as PrismaService,
      logging as unknown as LoggingService,
      intakeLink as unknown as IntakeLinkService,
      feeCalc as unknown as IntakeFeeCalculatorService,
      sms as unknown as SmsService,
      voiceState as unknown as VoiceConversationStateService,
    ),
    prisma,
    logging,
    intakeLink,
    feeCalc,
    sms,
    voiceState,
  };
};

const makeConversation = (collectedData: Record<string, unknown> = {}) => ({
  id: "conv-1",
  collectedData,
});

describe("VoiceIntakeSmsService", () => {
  describe("sendVoiceHandoffIntakeLink", () => {
    const baseParams = {
      tenantId: "tenant-1",
      conversationId: "conv-1",
      callSid: "CA_1",
      toPhone: "+15551234567",
      displayName: "ACME HVAC",
      isEmergency: false,
    };

    it("sends an SMS with the intake link", async () => {
      const prisma = buildPrisma();
      prisma.conversation.findFirst.mockResolvedValue(makeConversation() as never);
      prisma.conversation.update.mockResolvedValue({} as never);
      const sms = buildSmsService();
      const { service, intakeLink, feeCalc } = buildService({ prisma, sms });

      await service.sendVoiceHandoffIntakeLink(baseParams);

      expect(sms.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "+15551234567",
          tenantId: "tenant-1",
          conversationId: "conv-1",
        }),
      );
      expect(intakeLink.createConversationToken).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1", conversationId: "conv-1" }),
      );
      expect(feeCalc.computeTotalCents).toHaveBeenCalled();
    });

    it("logs success after SMS is sent", async () => {
      const prisma = buildPrisma();
      prisma.conversation.findFirst.mockResolvedValue(makeConversation() as never);
      prisma.conversation.update.mockResolvedValue({} as never);
      const logging = buildLogging();
      const { service } = buildService({ prisma, logging });

      await service.sendVoiceHandoffIntakeLink(baseParams);

      expect(logging.log).toHaveBeenCalledWith(
        expect.objectContaining({ event: "voice.sms_intake_link_sent" }),
        expect.any(String),
      );
    });

    it("skips when stripeSecretKey is not configured", async () => {
      const sms = buildSmsService();
      const { service } = buildService({
        config: { stripeSecretKey: "" as unknown as undefined },
        sms,
      });

      await service.sendVoiceHandoffIntakeLink(baseParams);

      expect(sms.sendMessage).not.toHaveBeenCalled();
    });

    it("skips and warns when no public base URL is configured", async () => {
      const sms = buildSmsService();
      const logging = buildLogging();
      const { service } = buildService({
        config: { smsIntakeBaseUrl: "" as unknown as undefined, twilioWebhookBaseUrl: "" as unknown as undefined },
        sms,
        logging,
      });

      await service.sendVoiceHandoffIntakeLink(baseParams);

      expect(sms.sendMessage).not.toHaveBeenCalled();
      expect(logging.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "voice.sms_intake_link_skipped" }),
        expect.any(String),
      );
    });

    it("skips when conversation is not found", async () => {
      const prisma = buildPrisma();
      prisma.conversation.findFirst.mockResolvedValue(null as never);
      const sms = buildSmsService();
      const { service } = buildService({ prisma, sms });

      await service.sendVoiceHandoffIntakeLink(baseParams);

      expect(sms.sendMessage).not.toHaveBeenCalled();
    });

    it("skips when a link has already been sent", async () => {
      const prisma = buildPrisma();
      prisma.conversation.findFirst.mockResolvedValue(
        makeConversation({
          voiceIntakePayment: {
            linkSentAt: "2024-01-01T00:00:00.000Z",
            intakeUrl: "https://intake.example.com/old_token",
          },
        }) as never,
      );
      const sms = buildSmsService();
      const { service } = buildService({ prisma, sms });

      await service.sendVoiceHandoffIntakeLink(baseParams);

      expect(sms.sendMessage).not.toHaveBeenCalled();
    });

    it("updates voiceIntakePayment state after sending", async () => {
      const prisma = buildPrisma();
      prisma.conversation.findFirst
        .mockResolvedValueOnce(makeConversation() as never)  // first call in sendVoiceHandoffIntakeLink
        .mockResolvedValueOnce(makeConversation() as never); // call inside updateVoiceIntakePaymentState
      prisma.conversation.update.mockResolvedValue({} as never);
      const { service } = buildService({ prisma });

      await service.sendVoiceHandoffIntakeLink(baseParams);

      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            collectedData: expect.objectContaining({
              voiceIntakePayment: expect.objectContaining({
                linkSentAt: expect.any(String),
                intakeUrl: "https://intake.example.com/tok_1",
              }),
            }),
          }),
        }),
      );
    });
  });

  describe("persistSmsIntakeFields", () => {
    it("promotes name, address, and issue from SMS", async () => {
      const voiceState = buildVoiceStateService();
      const { service } = buildService({ voiceState });

      await service.persistSmsIntakeFields({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        fullName: "Alice Smith",
        address: "123 Main St",
        issue: "AC not cooling",
      });

      expect(voiceState.promoteNameFromSms).toHaveBeenCalledWith(
        expect.objectContaining({ value: "Alice Smith" }),
      );
      expect(voiceState.promoteAddressFromSms).toHaveBeenCalledWith(
        expect.objectContaining({ value: "123 Main St" }),
      );
      expect(voiceState.updateVoiceIssueCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          issue: expect.objectContaining({ value: "AC not cooling" }),
        }),
      );
    });
  });

  describe("updateVoiceIntakePaymentState", () => {
    it("merges new state into voiceIntakePayment in collectedData", async () => {
      const prisma = buildPrisma();
      prisma.conversation.findFirst.mockResolvedValue(
        makeConversation({ existingKey: "preserved" }) as never,
      );
      prisma.conversation.update.mockResolvedValue({} as never);
      const { service } = buildService({ prisma });

      await service.updateVoiceIntakePaymentState({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        next: { checkoutSessionId: "cs_1", amountCents: 9900 },
      });

      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            collectedData: expect.objectContaining({
              existingKey: "preserved",
              voiceIntakePayment: expect.objectContaining({
                checkoutSessionId: "cs_1",
                amountCents: 9900,
              }),
            }),
          }),
        }),
      );
    });

    it("is a no-op when conversation is not found", async () => {
      const prisma = buildPrisma();
      prisma.conversation.findFirst.mockResolvedValue(null as never);
      const { service } = buildService({ prisma });

      await service.updateVoiceIntakePaymentState({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        next: { amountCents: 9900 },
      });

      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });
  });
});
