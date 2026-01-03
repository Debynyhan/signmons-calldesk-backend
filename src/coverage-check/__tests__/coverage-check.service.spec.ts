import { Test } from "@nestjs/testing";
import {
  CoverageReasonCode,
  CoverageStatus,
  ServiceAreaStatus,
  ServiceAreaType,
} from "@prisma/client";
import { CoverageCheckService } from "../coverage-check.service";
import { PrismaService } from "../../prisma/prisma.service";
import { LoggingService } from "../../logging/logging.service";

const mockPrisma = {
  propertyAddress: {
    findFirst: jest.fn(),
  },
  serviceArea: {
    findMany: jest.fn(),
  },
  customerCoverageCheck: {
    create: jest.fn(),
  },
};

const mockLogging: jest.Mocked<LoggingService> = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as jest.Mocked<LoggingService>;

describe("CoverageCheckService", () => {
  let service: CoverageCheckService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CoverageCheckService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LoggingService, useValue: mockLogging },
      ],
    }).compile();

    service = moduleRef.get(CoverageCheckService);
  });

  it("marks in-coverage for polygon match", async () => {
    mockPrisma.propertyAddress.findFirst.mockResolvedValue({
      id: "addr-1",
      tenantId: "tenant-1",
      latitude: 1,
      longitude: 1,
      addressComponents: null,
    });

    mockPrisma.serviceArea.findMany.mockResolvedValue([
      {
        id: "area-1",
        tenantId: "tenant-1",
        type: ServiceAreaType.POLYGON,
        status: ServiceAreaStatus.ACTIVE,
        definition: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [0, 2],
              [2, 2],
              [2, 0],
              [0, 0],
            ],
          ],
        },
      },
    ]);

    mockPrisma.customerCoverageCheck.create.mockResolvedValue({
      id: "check-1",
    });

    await service.evaluateAndRecord({
      tenantId: "tenant-1",
      propertyAddressId: "addr-1",
    });

    expect(mockPrisma.customerCoverageCheck.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CoverageStatus.IN_COVERAGE,
          reasonCode: CoverageReasonCode.OTHER,
          serviceAreaId: "area-1",
        }),
      }),
    );
  });

  it("marks out-of-coverage when geo missing", async () => {
    mockPrisma.propertyAddress.findFirst.mockResolvedValue({
      id: "addr-2",
      tenantId: "tenant-1",
      latitude: null,
      longitude: null,
      addressComponents: null,
    });

    mockPrisma.serviceArea.findMany.mockResolvedValue([]);
    mockPrisma.customerCoverageCheck.create.mockResolvedValue({
      id: "check-2",
    });

    await service.evaluateAndRecord({
      tenantId: "tenant-1",
      propertyAddressId: "addr-2",
    });

    expect(mockPrisma.customerCoverageCheck.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CoverageStatus.OUT_OF_COVERAGE,
          reasonCode: CoverageReasonCode.MISSING_GEO,
        }),
      }),
    );
  });
});
