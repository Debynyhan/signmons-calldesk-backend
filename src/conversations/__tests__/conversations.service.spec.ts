import { ConversationsService } from "../conversations.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";
import { LoggingService } from "../../logging/logging.service";

describe("ConversationsService", () => {
  let prisma: {
    conversation: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    customer: { create: jest.Mock; findFirst: jest.Mock };
  };
  let service: ConversationsService;
  let loggingService: { warn: jest.Mock };

  beforeEach(() => {
    prisma = {
      conversation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    loggingService = {
      warn: jest.fn(),
    };

    service = new ConversationsService(
      prisma as unknown as PrismaService,
      new SanitizationService(),
      loggingService as unknown as LoggingService,
    );
  });

  it("persists CallSid on voice consent conversation creation", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null as never);
    prisma.customer.findFirst.mockResolvedValue(null as never);
    prisma.customer.create.mockResolvedValue({ id: "cust-1" } as never);
    prisma.conversation.create.mockResolvedValue({ id: "conv-1" } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      requestId: "req-1",
      callerPhone: "2167448929",
    });

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          twilioCallSid: "CA123",
          collectedData: expect.objectContaining({
            requestId: "req-1",
            callerPhone: "+12167448929",
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

  it("reuses an existing customer by normalized phone", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null as never);
    prisma.customer.findFirst.mockResolvedValue({ id: "cust-1" } as never);
    prisma.conversation.create.mockResolvedValue({ id: "conv-1" } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      callerPhone: "(216) 744-8929",
    });

    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("creates a customer when none exists for caller phone", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null as never);
    prisma.customer.findFirst.mockResolvedValue(null as never);
    prisma.customer.create.mockResolvedValue({ id: "cust-1" } as never);
    prisma.conversation.create.mockResolvedValue({ id: "conv-1" } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      callerPhone: "2167448929",
    });

    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: "+12167448929",
        }),
      }),
    );
  });

  it("creates a placeholder customer if customer creation fails", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null as never);
    prisma.customer.findFirst.mockResolvedValue(null as never);
    prisma.customer.create
      .mockRejectedValueOnce(new Error("insert failed"))
      .mockResolvedValueOnce({ id: "cust-2" } as never);
    prisma.conversation.create.mockResolvedValue({ id: "conv-1" } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      callerPhone: "2167448929",
    });

    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice_customer_create_failed",
        tenantId: "tenant-1",
      }),
      ConversationsService.name,
    );
    expect(prisma.customer.create).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite callerPhone once set", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: { callerPhone: "+12167448929", voiceConsent: { granted: true } },
    } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      callerPhone: "2165550000",
    });

    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});
