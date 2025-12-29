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

export class ConversationResponseDto {
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
  @IsIn(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @Transform(trimToString)
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number];

  @Transform(trimToString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  currentFSMState?: string | null;

  @IsOptional()
  @IsObject()
  collectedData?: Record<string, unknown> | null;

  @Transform(trimToString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerConversationId?: string | null;

  @Transform(trimToString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  twilioCallSid?: string | null;

  @Transform(trimToString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  twilioSmsSid?: string | null;

  @IsDateString()
  startedAt!: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string | null;

  @IsDateString()
  createdAt!: string;

  @IsDateString()
  updatedAt!: string;
}
