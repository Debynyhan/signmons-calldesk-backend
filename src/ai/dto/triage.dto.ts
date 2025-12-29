import { Transform, TransformFnParams } from "class-transformer";
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { IsSafeMessage } from "../../common/validators/is-safe-message.decorator";

const trimToString = ({ value }: TransformFnParams): string =>
  typeof value === "string" ? value.trim() : "";

const CHANNELS = ["VOICE", "SMS", "WEBCHAT"] as const;

type Channel = (typeof CHANNELS)[number];

export class TriageDto {
  @Transform(trimToString)
  @IsUUID("4", { message: "tenantId must be a valid UUID (v4)." })
  tenantId!: string;

  @Transform(trimToString)
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  sessionId!: string;

  @Transform(trimToString)
  @IsString()
  @IsSafeMessage()
  message!: string;

  @Transform(trimToString)
  @IsOptional()
  @IsIn(CHANNELS, {
    message: `channel must be one of: ${CHANNELS.join(", ")}`,
  })
  channel?: Channel;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
