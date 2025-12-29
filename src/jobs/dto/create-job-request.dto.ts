import { Transform, TransformFnParams } from "class-transformer";
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsDateString,
} from "class-validator";

const trimToString = ({ value }: TransformFnParams): string =>
  typeof value === "string" ? value.trim() : "";

const URGENCY_LEVELS = ["STANDARD", "EMERGENCY"] as const;
const WINDOW_LABELS = ["ASAP", "MORNING", "AFTERNOON", "EVENING"] as const;

export class CreateJobRequestDto {
  @Transform(trimToString)
  @IsUUID("4", { message: "tenantId must be a valid UUID (v4)." })
  tenantId!: string;

  @Transform(trimToString)
  @IsUUID("4", { message: "customerId must be a valid UUID (v4)." })
  customerId!: string;

  @Transform(trimToString)
  @IsUUID("4", { message: "propertyAddressId must be a valid UUID (v4)." })
  propertyAddressId!: string;

  @Transform(trimToString)
  @IsUUID("4", { message: "serviceCategoryId must be a valid UUID (v4)." })
  serviceCategoryId!: string;

  @Transform(trimToString)
  @IsOptional()
  @IsUUID("4", { message: "assignedUserId must be a valid UUID (v4)." })
  assignedUserId?: string;

  @IsIn(URGENCY_LEVELS, {
    message: `urgency must be one of: ${URGENCY_LEVELS.join(", ")}`,
  })
  urgency!: (typeof URGENCY_LEVELS)[number];

  @Transform(trimToString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @Transform(trimToString)
  @IsOptional()
  @IsIn(WINDOW_LABELS, {
    message: `preferredWindowLabel must be one of: ${WINDOW_LABELS.join(", ")}`,
  })
  preferredWindowLabel?: (typeof WINDOW_LABELS)[number];

  @IsOptional()
  @IsDateString()
  serviceWindowStart?: string;

  @IsOptional()
  @IsDateString()
  serviceWindowEnd?: string;

  @IsOptional()
  @IsObject()
  pricingSnapshot?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  policySnapshot?: Record<string, unknown>;
}
