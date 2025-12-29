import { Transform, TransformFnParams } from "class-transformer";
import { IsUUID } from "class-validator";

const trimToString = ({ value }: TransformFnParams): string =>
  typeof value === "string" ? value.trim() : "";

export class ListConversationsQueryDto {
  @Transform(trimToString)
  @IsUUID("4", { message: "tenantId must be a valid UUID (v4)." })
  tenantId!: string;
}
