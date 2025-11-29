import { IsUUID } from "class-validator";
import { IsSafeMessage } from "../../common/validators/is-safe-message.decorator";

export class TriageDto {
  @IsUUID("4", { message: "tenantId must be a valid UUID (v4)." })
  tenantId!: string;

  @IsSafeMessage()
  message!: string;
}
