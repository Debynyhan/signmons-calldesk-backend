import { Type } from "class-transformer";
import {
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class FeeSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  serviceFeeCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  emergencyFeeCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  creditWindowHours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;
}

export class UpdateTenantFeeSettingsDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => FeeSettingsDto)
  fees!: FeeSettingsDto;
}
