import { CallLogService } from "../call-log.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";

describe("CallLogService", () => {
  let prisma: {
    communicationContent: { findMany: jest.Mock };
  };
  let service: CallLogService;

  beforeEach(() => {
    prisma = {
      communicationContent: {
        findMany: jest.fn(),
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
});
