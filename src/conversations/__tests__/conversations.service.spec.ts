import { ConversationsService } from "../conversations.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";

describe("ConversationsService", () => {
  let prisma: {
    conversation: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    customer: { create: jest.Mock };
  };
  let service: ConversationsService;

  beforeEach(() => {
    prisma = {
      conversation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        create: jest.fn(),
      },
    };

    service = new ConversationsService(
      prisma as unknown as PrismaService,
      new SanitizationService(),
    );
  });

  it("persists CallSid on voice consent conversation creation", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null as never);
    prisma.customer.create.mockResolvedValue({ id: "cust-1" } as never);
    prisma.conversation.create.mockResolvedValue({ id: "conv-1" } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      requestId: "req-1",
    });

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          twilioCallSid: "CA123",
          collectedData: expect.objectContaining({
            requestId: "req-1",
            voiceConsent: expect.objectContaining({
              granted: true,
              method: "implied",
              callSid: "CA123",
            }),
          }),
        }),
      }),
    );
  });
});
