import { Transform, TransformFnParams } from "class-transformer";
import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { IsSafeMessage } from "../../common/validators/is-safe-message.decorator";

const trimToString = ({ value }: TransformFnParams): string =>
  typeof value === "string" ? value.trim() : "";

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
}
