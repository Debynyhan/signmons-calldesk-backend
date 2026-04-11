import { BadRequestException, Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { JobUrgency, PreferredWindowLabel } from "@prisma/client";
import { SanitizationService } from "../sanitization/sanitization.service";
import { IssueNormalizerService } from "./issue-normalizer.service";
import { CreateJobPayloadDto } from "./dto/create-job-payload.dto";
import type { CreateJobPayload } from "./interfaces/job-repository.interface";

@Injectable()
export class CreateJobPayloadValidatorService {
  constructor(
    private readonly sanitizationService: SanitizationService,
    private readonly issueNormalizer: IssueNormalizerService,
  ) {}

  parseAndNormalize(rawArgs?: string): {
    payload: CreateJobPayload;
    mappedUrgency: JobUrgency;
    mappedPreferredWindow: PreferredWindowLabel | undefined;
    audit: {
      rawArgs: string;
      normalizedArgs: CreateJobPayload;
      validationErrors?: unknown;
    };
  } {
    const raw = this.parseRawArgs(rawArgs);
    const normalized = this.normalizePayload(raw);
    const extraKeys = this.findUnexpectedKeys(raw);
    const errors = this.validatePayload(normalized);
    const audit = {
      rawArgs: rawArgs ?? "",
      normalizedArgs: normalized,
      validationErrors:
        errors.length || extraKeys.length
          ? { errors, extraKeys }
          : undefined,
    };
    if (extraKeys.length) {
      throw new BadRequestException(
        this.buildValidationError("Job payload contains unexpected fields.", audit),
      );
    }
    if (errors.length) {
      throw new BadRequestException(
        this.buildValidationError("Job payload validation failed.", audit),
      );
    }
    if (!this.issueNormalizer.isPreferredTimeValid(normalized.preferredTime)) {
      throw new BadRequestException(
        this.buildValidationError("Preferred time is invalid.", audit),
      );
    }
    return {
      payload: normalized,
      mappedUrgency: this.issueNormalizer.mapUrgency(normalized.urgency),
      mappedPreferredWindow: this.issueNormalizer.mapPreferredWindow(
        normalized.preferredTime,
      ),
      audit,
    };
  }

  private parseRawArgs(rawArgs?: string): Record<string, unknown> {
    if (!rawArgs?.trim()) {
      throw new BadRequestException("Job payload missing.");
    }
    try {
      const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") {
        throw new BadRequestException("Job payload must be an object.");
      }
      return parsed;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException("Invalid job creation payload.");
    }
  }

  private findUnexpectedKeys(payload: Record<string, unknown>): string[] {
    const allowed = new Set([
      "customerName",
      "phone",
      "address",
      "issueCategory",
      "urgency",
      "description",
      "preferredTime",
    ]);
    return Object.keys(payload).filter((key) => !allowed.has(key));
  }

  private normalizePayload(payload: Record<string, unknown>): CreateJobPayload {
    const normalizedIssueCategory = this.issueNormalizer.normalizeIssueCategory(
      payload.issueCategory,
    );
    const normalizedUrgency = this.issueNormalizer.normalizeUrgency(payload.urgency);
    const normalizedPreferredTime = this.issueNormalizer.normalizePreferredTime(
      payload.preferredTime,
    );
    return {
      customerName: this.normalizeRequiredText(payload.customerName),
      phone: this.normalizePhone(payload.phone),
      address: this.normalizeOptionalText(payload.address),
      issueCategory: normalizedIssueCategory,
      urgency: normalizedUrgency,
      description: this.normalizeOptionalText(payload.description),
      preferredTime: normalizedPreferredTime,
    };
  }

  private validatePayload(payload: CreateJobPayload) {
    const dto = plainToInstance(CreateJobPayloadDto, payload);
    return validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
  }

  private buildValidationError(
    message: string,
    audit: { rawArgs: string; normalizedArgs: CreateJobPayload },
  ) {
    const includeAudit = process.env.NODE_ENV !== "production";
    return includeAudit ? { message, audit } : { message };
  }

  private normalizeRequiredText(value: unknown): string {
    if (typeof value !== "string") return "";
    return this.sanitizationService.sanitizeText(value);
  }

  private normalizeOptionalText(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const sanitized = this.sanitizationService.sanitizeText(value);
    return sanitized.length ? sanitized : undefined;
  }

  private normalizePhone(value: unknown): string {
    if (typeof value !== "string") return "";
    const digits = value.replace(/\D/g, "");
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith("1")) {
      return `+${digits}`;
    }
    if (digits.length >= 8 && digits.length <= 15) {
      return `+${digits}`;
    }
    return "";
  }
}
