import { Transform, TransformFnParams } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

const trimToString = ({ value }: TransformFnParams): string =>
  typeof value === "string" ? value.trim() : "";

const CHANNELS = ["VOICE", "SMS", "WEBCHAT"] as const;
const STATUSES = [
  "ONGOING",
  "COMPLETED",
  "ABANDONED",
  "FAILED_PAYMENT",
] as const;

export class CreateConversationDto {
  @Transform(trimToString)
  @IsUUID("4", { message: "tenantId must be a valid UUID (v4)." })
  tenantId!: string;

  @Transform(trimToString)
  @IsUUID("4", { message: "customerId must be a valid UUID (v4)." })
  customerId!: string;

  @Transform(trimToString)
  @IsIn(CHANNELS, { message: `channel must be one of: ${CHANNELS.join(", ")}` })
  channel!: (typeof CHANNELS)[number];

  @Transform(trimToString)
  @IsOptional()
  @IsIn(STATUSES, {
    message: `status must be one of: ${STATUSES.join(", ")}`,
  })
  status?: (typeof STATUSES)[number];

  @Transform(trimToString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  currentFSMState?: string;

  @IsOptional()
  @IsObject()
  collectedData?: Record<string, unknown>;

  @Transform(trimToString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerConversationId?: string;

  @Transform(trimToString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  twilioCallSid?: string;

  @Transform(trimToString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  twilioSmsSid?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;
}
