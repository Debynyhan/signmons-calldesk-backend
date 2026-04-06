import { CallLogService } from "../call-log.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";

describe("CallLogService", () => {
  let prisma: {
    communicationEvent: { create: jest.Mock };
    communicationContent: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let service: CallLogService;

  beforeEach(() => {
    prisma = {
      communicationEvent: {
        create: jest.fn(),
      },
      communicationContent: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    service = new CallLogService(
      prisma as unknown as PrismaService,
      new SanitizationService(),
    );
  });

  it("returns voice transcripts in chronological order", async () => {
    const older = new Date("2026-01-01T10:00:00.000Z");
    const newer = new Date("2026-01-01T10:01:00.000Z");
    prisma.communicationContent.findMany.mockResolvedValue([
      {
        payload: {
          type: "voice_transcript",
          transcript: "first",
          confidence: 0.9,
        },
        createdAt: older,
      },
      {
        payload: {
          type: "voice_transcript",
          transcript: "second",
          confidence: 0.7,
        },
        createdAt: newer,
      },
    ]);

    const results = await service.getVoiceTranscripts({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    });

    expect(prisma.communicationContent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(results.map((entry) => entry.transcript)).toEqual([
      "first",
      "second",
    ]);
  });

  it("stores voice transcripts with text-only payload", async () => {
    prisma.communicationEvent.create.mockResolvedValue({} as never);

    await service.createVoiceTranscriptLog({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      callSid: "CA123",
      transcript: "Caller said no heat.",
      confidence: 0.82,
      occurredAt: new Date("2026-01-01T10:00:00.000Z"),
    });

    const payload =
      prisma.communicationEvent.create.mock.calls[0][0].data.content.create
        .payload;
    expect(payload).toMatchObject({
      type: "voice_transcript",
      callSid: "CA123",
      transcript: "Caller said no heat.",
      confidence: 0.82,
    });
    expect(payload).not.toHaveProperty("RecordingUrl");
    expect(payload).not.toHaveProperty("recordingUrl");
  });

  it("queries recent messages by session id or voice call sid", async () => {
    prisma.communicationContent.findFirst.mockResolvedValue(null);
    prisma.communicationContent.findMany.mockResolvedValue([]);

    await service.getRecentMessages("tenant-1", "CA123", 10);

    expect(prisma.communicationContent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          OR: expect.arrayContaining([
            expect.objectContaining({
              payload: {
                path: ["sessionId"],
                equals: "CA123",
              },
            }),
            expect.objectContaining({
              communicationEvent: {
                channel: "VOICE",
              },
              payload: {
                path: ["callSid"],
                equals: "CA123",
              },
            }),
          ]),
        }),
      }),
    );
  });

  it("stores voice assistant messages with session id for continuity", async () => {
    prisma.communicationContent.findFirst.mockResolvedValue(null);
    prisma.communicationEvent.create.mockResolvedValue({} as never);

    await service.createVoiceAssistantLog({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      callSid: "CA123",
      message: "Thanks. We'll text you next steps.",
      sourceEventId: "evt-1",
    });

    const payload =
      prisma.communicationEvent.create.mock.calls[0][0].data.content.create
        .payload;
    expect(payload).toMatchObject({
      type: "message",
      sessionId: "CA123",
      callSid: "CA123",
      message: "Thanks. We'll text you next steps.",
      sourceEventId: "evt-1",
      role: "assistant",
    });
  });
});
