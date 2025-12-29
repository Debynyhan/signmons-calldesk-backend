import { Transform, TransformFnParams } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

const trimToString = ({ value }: TransformFnParams): string =>
  typeof value === "string" ? value.trim() : "";

const JOB_STATUSES = [
  "CREATED",
  "OFFERED",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

const URGENCY_LEVELS = ["STANDARD", "EMERGENCY"] as const;
const WINDOW_LABELS = ["ASAP", "MORNING", "AFTERNOON", "EVENING"] as const;

export class JobResponseDto {
  @Transform(trimToString)
  @IsUUID("4")
  id!: string;

  @Transform(trimToString)
  @IsUUID("4")
  tenantId!: string;

  @Transform(trimToString)
  @IsUUID("4")
  customerId!: string;

  @Transform(trimToString)
  @IsUUID("4")
  propertyAddressId!: string;

  @Transform(trimToString)
  @IsUUID("4")
  serviceCategoryId!: string;

  @Transform(trimToString)
  @IsOptional()
  @IsUUID("4")
  assignedUserId?: string;

  @IsIn(JOB_STATUSES)
  status!: (typeof JOB_STATUSES)[number];

  @IsIn(URGENCY_LEVELS)
  urgency!: (typeof URGENCY_LEVELS)[number];

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsIn(WINDOW_LABELS)
  preferredWindowLabel?: (typeof WINDOW_LABELS)[number] | null;

  @IsOptional()
  @IsObject()
  pricingSnapshot?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  policySnapshot?: Record<string, unknown> | null;

  @IsOptional()
  @IsDateString()
  serviceWindowStart?: string | null;

  @IsOptional()
  @IsDateString()
  serviceWindowEnd?: string | null;

  @IsOptional()
  @IsDateString()
  offerExpiresAt?: string | null;

  @IsOptional()
  @IsDateString()
  acceptedAt?: string | null;

  @IsOptional()
  @IsDateString()
  completedAt?: string | null;

  @IsDateString()
  createdAt!: string;

  @IsDateString()
  updatedAt!: string;

  @IsOptional()
  @IsString()
  serviceCategoryName?: string;
}
