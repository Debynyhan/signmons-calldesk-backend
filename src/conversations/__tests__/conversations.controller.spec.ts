import { Test } from "@nestjs/testing";
import type { Request } from "express";
import type { CreateConversationDto } from "../dto/create-conversation.dto";
import type { ListConversationsQueryDto } from "../dto/list-conversations-query.dto";
import { ConversationsController } from "../conversations.controller";
import { ConversationsService } from "../conversations.service";
import { FirebaseAuthGuard } from "../../auth/firebase-auth.guard";
import { TenantGuard } from "../../common/guards/tenant.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ConfigService } from "@nestjs/config";
import { LoggingService } from "../../logging/logging.service";

describe("ConversationsController", () => {
  let controller: ConversationsController;
  const conversationsService = {
    createConversation: jest.fn(),
    listConversations: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        {
          provide: ConversationsService,
          useValue: conversationsService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: LoggingService,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: FirebaseAuthGuard,
          useValue: {
            canActivate: () => true,
          },
        },
        {
          provide: TenantGuard,
          useValue: {
            canActivate: () => true,
          },
        },
        {
          provide: RolesGuard,
          useValue: {
            canActivate: () => true,
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(ConversationsController);
  });

  afterEach(() => {
    conversationsService.createConversation.mockReset();
    conversationsService.listConversations.mockReset();
  });

  it("creates a conversation", async () => {
    const now = new Date("2025-02-01T00:00:00.000Z");
    conversationsService.createConversation.mockResolvedValue({
      id: "conv-1",
      tenantId: "tenant-1",
      customerId: "customer-1",
      channel: "WEBCHAT",
      status: "ONGOING",
      currentFSMState: "INTAKE",
      collectedData: { issue: "no heat" },
      providerConversationId: "session-1",
      twilioCallSid: null,
      twilioSmsSid: null,
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const response = await controller.createConversation(
      {
        tenantId: "tenant-1",
        customerId: "customer-1",
        channel: "WEBCHAT",
        currentFSMState: "INTAKE",
        collectedData: { issue: "no heat" },
        providerConversationId: "session-1",
        startedAt: now.toISOString(),
      } as CreateConversationDto,
      { authUser: { tenantId: "tenant-1" } } as unknown as Request,
    );

    expect(response).toEqual({
      id: "conv-1",
      tenantId: "tenant-1",
      customerId: "customer-1",
      channel: "WEBCHAT",
      status: "ONGOING",
      currentFSMState: "INTAKE",
      collectedData: { issue: "no heat" },
      providerConversationId: "session-1",
      twilioCallSid: null,
      twilioSmsSid: null,
      startedAt: now.toISOString(),
      endedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it("lists conversations for a tenant", async () => {
    const now = new Date("2025-02-02T00:00:00.000Z");
    conversationsService.listConversations.mockResolvedValue([
      {
        id: "conv-2",
        tenantId: "tenant-2",
        customerId: "customer-2",
        channel: "SMS",
        status: "COMPLETED",
        currentFSMState: "DONE",
        collectedData: null,
        providerConversationId: null,
        twilioCallSid: "call-1",
        twilioSmsSid: "sms-1",
        startedAt: now,
        endedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const response = await controller.listConversations(
      {
        tenantId: "tenant-2",
      } as ListConversationsQueryDto,
      { authUser: { tenantId: "tenant-2" } } as unknown as Request,
    );

    expect(response).toEqual([
      {
        id: "conv-2",
        tenantId: "tenant-2",
        customerId: "customer-2",
        channel: "SMS",
        status: "COMPLETED",
        currentFSMState: "DONE",
        collectedData: null,
        providerConversationId: null,
        twilioCallSid: "call-1",
        twilioSmsSid: "sms-1",
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ]);
  });
});
