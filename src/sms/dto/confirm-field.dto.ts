import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class ConfirmFieldDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  conversationId!: string;

  @IsIn(["name", "address"])
  field!: "name" | "address";

  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  value!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  sourceEventId?: string;
}
