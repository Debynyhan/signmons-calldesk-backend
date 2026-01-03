import { Injectable, NotFoundException } from "@nestjs/common";
import {
  CoverageReasonCode,
  CoverageStatus,
  Prisma,
  PropertyAddress,
  ServiceArea,
  ServiceAreaStatus,
  ServiceAreaType,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LoggingService } from "../logging/logging.service";

type CoverageMatch = {
  matched: boolean;
  metadata?: Record<string, unknown>;
};

type Point = { lat: number; lng: number };
type PolygonRing = number[][];
type ZipLike = { zips?: unknown; postalCodes?: unknown };
type AddressComponent = {
  types?: unknown;
  long_name?: unknown;
  short_name?: unknown;
  postalCode?: unknown;
  zip?: unknown;
};

type RadiusDefinition = {
  center: { lat: number; lng: number };
  radiusMeters: number;
};

type PolygonDefinition = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

type ZipDefinition = {
  zips?: string[];
  postalCodes?: string[];
};

@Injectable()
export class CoverageCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logging: LoggingService,
  ) {}

  async evaluateAndRecord(params: {
    tenantId: string;
    propertyAddressId: string;
  }) {
    const { tenantId, propertyAddressId } = params;

    const property = await this.prisma.propertyAddress.findFirst({
      where: { id: propertyAddressId, tenantId },
    });

    if (!property) {
      throw new NotFoundException("Property address not found for tenant.");
    }

    if (!this.hasGeo(property)) {
      return this.createCoverageCheck({
        tenantId,
        property,
        status: CoverageStatus.OUT_OF_COVERAGE,
        reasonCode: CoverageReasonCode.MISSING_GEO,
        serviceArea: null,
        metadata: { reason: "missing_geo" },
      });
    }

    const serviceAreas = await this.prisma.serviceArea.findMany({
      where: { tenantId, status: ServiceAreaStatus.ACTIVE },
    });

    let matchedArea: ServiceArea | null = null;
    let matchMetadata: Record<string, unknown> | undefined;

    const point: Point = {
      lat: property.latitude,
      lng: property.longitude,
    };

    for (const area of serviceAreas) {
      const match = this.matchesServiceArea(area, property, point);
      if (match.matched) {
        matchedArea = area;
        matchMetadata = match.metadata;
        break;
      }
    }

    const status = matchedArea
      ? CoverageStatus.IN_COVERAGE
      : CoverageStatus.OUT_OF_COVERAGE;
    const reasonCode = matchedArea
      ? CoverageReasonCode.OTHER
      : CoverageReasonCode.NO_MATCH;

    return this.createCoverageCheck({
      tenantId,
      property,
      status,
      reasonCode,
      serviceArea: matchedArea,
      metadata: {
        matchedServiceAreaId: matchedArea?.id ?? null,
        matchedType: matchedArea?.type ?? null,
        ...matchMetadata,
      },
    });
  }

  private async createCoverageCheck(params: {
    tenantId: string;
    property: PropertyAddress;
    status: CoverageStatus;
    reasonCode: CoverageReasonCode;
    serviceArea: ServiceArea | null;
    metadata?: Prisma.InputJsonValue;
  }) {
    const { tenantId, property, status, reasonCode, serviceArea, metadata } =
      params;

    return this.prisma.customerCoverageCheck.create({
      data: {
        tenantId,
        propertyAddressId: property.id,
        propertyAddressTenantId: tenantId,
        serviceAreaId: serviceArea?.id ?? null,
        serviceAreaTenantId: serviceArea?.tenantId ?? null,
        status,
        reasonCode,
        metadata: metadata ?? {},
      },
    });
  }

  private hasGeo(property: PropertyAddress): boolean {
    return (
      typeof property.latitude === "number" &&
      typeof property.longitude === "number"
    );
  }

  private matchesServiceArea(
    area: ServiceArea,
    property: PropertyAddress,
    point: Point,
  ): CoverageMatch {
    try {
      switch (area.type) {
        case ServiceAreaType.RADIUS: {
          const def = this.parseRadiusDefinition(area.definition);
          if (!def) return { matched: false };
          const distance = this.haversine(point, def.center);
          return {
            matched: distance <= def.radiusMeters,
            metadata: {
              distanceMeters: distance,
              radiusMeters: def.radiusMeters,
            },
          };
        }
        case ServiceAreaType.POLYGON: {
          const polygons = this.parsePolygonDefinition(area.definition);
          if (!polygons) return { matched: false };
          const matched = polygons.some((ring) =>
            this.pointInPolygon(point, ring),
          );
          return { matched };
        }
        case ServiceAreaType.ZIP: {
          const def = this.parseZipDefinition(area.definition);
          if (!def) return { matched: false };
          const postalCode = this.extractPostalCode(property.addressComponents);
          if (!postalCode) {
            return {
              matched: false,
              metadata: { reason: "missing_postal_code" },
            };
          }
          const zips = new Set(
            [...(def.zips ?? []), ...(def.postalCodes ?? [])].map((z) =>
              z.trim(),
            ),
          );
          return { matched: zips.has(postalCode) };
        }
        default:
          return { matched: false };
      }
    } catch (error) {
      this.logging.warn(
        `Failed to evaluate service area ${area.id}: ${String(error)}`,
        "CoverageCheckService",
      );
      return { matched: false };
    }
  }

  private parseRadiusDefinition(definition: unknown): RadiusDefinition | null {
    if (!definition || typeof definition !== "object") return null;
    const def = definition as Record<string, unknown>;
    const center = def.center as Record<string, unknown> | undefined;
    const radiusMeters = def.radiusMeters as number | undefined;
    if (
      !center ||
      typeof center.lat !== "number" ||
      typeof center.lng !== "number" ||
      typeof radiusMeters !== "number"
    ) {
      return null;
    }
    return { center: { lat: center.lat, lng: center.lng }, radiusMeters };
  }

  private parsePolygonDefinition(definition: unknown): PolygonRing[] | null {
    if (!this.isPolygonDefinition(definition)) return null;
    const def = definition;
    if (def.type === "Polygon" && this.isPolygonRingArray(def.coordinates)) {
      return def.coordinates;
    }
    if (def.type === "MultiPolygon" && Array.isArray(def.coordinates)) {
      const flattened = def.coordinates.flat();
      if (this.isPolygonRingArray(flattened)) {
        return flattened;
      }
    }
    return null;
  }

  private isPolygonRingArray(coords: unknown): coords is PolygonRing[] {
    return (
      Array.isArray(coords) &&
      coords.every(
        (ring) =>
          Array.isArray(ring) &&
          ring.every(
            (pt) =>
              Array.isArray(pt) &&
              pt.length >= 2 &&
              pt.every((n) => typeof n === "number"),
          ),
      )
    );
  }

  private isPolygonDefinition(
    definition: unknown,
  ): definition is PolygonDefinition {
    if (!definition || typeof definition !== "object") return false;
    const type = (definition as { type?: unknown }).type;
    return type === "Polygon" || type === "MultiPolygon";
  }

  private parseZipDefinition(definition: unknown): ZipDefinition | null {
    if (!this.isZipLike(definition)) return null;
    const zipsRaw = definition.zips;
    const postalRaw = definition.postalCodes;

    const zips = Array.isArray(zipsRaw)
      ? zipsRaw.filter((z): z is string => typeof z === "string")
      : [];
    const postalCodes = Array.isArray(postalRaw)
      ? postalRaw.filter((z): z is string => typeof z === "string")
      : [];

    const hasZips = zips.length > 0;
    const hasPostal = postalCodes.length > 0;
    if (!hasZips && !hasPostal) return null;
    return {
      zips: hasZips ? zips : undefined,
      postalCodes: hasPostal ? postalCodes : undefined,
    };
  }

  private isZipLike(value: unknown): value is ZipLike {
    return !!value && typeof value === "object";
  }

  private extractPostalCode(addressComponents: unknown): string | null {
    if (!addressComponents) return null;
    try {
      const parsed: unknown =
        typeof addressComponents === "string"
          ? JSON.parse(addressComponents)
          : addressComponents;

      if (!Array.isArray(parsed)) return null;

      for (const component of parsed) {
        if (!this.isAddressComponent(component)) {
          continue;
        }

        const types: string[] = Array.isArray(component.types)
          ? component.types.filter((t): t is string => typeof t === "string")
          : [];

        if (types.includes("postal_code")) {
          const code =
            (typeof component.long_name === "string" && component.long_name) ||
            (typeof component.short_name === "string" &&
              component.short_name) ||
            null;
          if (code) return code;
        }

        if (typeof component.postalCode === "string") {
          return component.postalCode;
        }
        if (typeof component.zip === "string") return component.zip;
      }
    } catch (error) {
      this.logging.warn(
        `Failed to parse addressComponents for postal code: ${String(error)}`,
        "CoverageCheckService",
      );
    }
    return null;
  }

  private isAddressComponent(value: unknown): value is AddressComponent {
    return !!value && typeof value === "object";
  }

  private haversine(a: Point, b: Point): number {
    const R = 6371000; // meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return R * c;
  }

  private pointInPolygon(point: Point, ring: PolygonRing): boolean {
    // Ray casting algorithm for polygons (single ring)
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      const intersect =
        yi > point.lng !== yj > point.lng &&
        point.lat < ((xj - xi) * (point.lng - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
}
