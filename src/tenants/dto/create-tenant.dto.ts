import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

class TenantSettingsDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  displayName?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  instructions?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  diagnosticFeeCents?: number;

  @IsOptional()
  @IsBoolean()
  emergencySurchargeEnabled?: boolean;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  emergencySurchargeAmountCents?: number;
}

export class CreateTenantDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  name!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  timezone?: string;

  @ValidateNested()
  @Type(() => TenantSettingsDto)
  @IsOptional()
  settings?: TenantSettingsDto;
}
