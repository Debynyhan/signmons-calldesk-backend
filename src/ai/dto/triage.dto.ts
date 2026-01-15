import { Transform, TransformFnParams } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";
import { IsSafeMessage } from "../../common/validators/is-safe-message.decorator";

const trimToString = ({ value }: TransformFnParams): string =>
  typeof value === "string" ? value.trim() : "";

export class TriageDto {
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
