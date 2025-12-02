import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateTenantDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  name!: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  displayName!: string;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  instructions!: string;
}
