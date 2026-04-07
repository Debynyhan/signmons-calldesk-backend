import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on", "emergency"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off", "standard"].includes(normalized)) {
    return false;
  }
  return undefined;
}

export class IntakeCheckoutDto {
  @Transform(({ value }) => toTrimmedString(value))
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @Transform(({ value }) => toTrimmedString(value))
  @IsOptional()
  @IsString()
  @MinLength(5)
  address?: string;

  @Transform(({ value }) => toTrimmedString(value))
  @IsOptional()
  @IsString()
  @MinLength(3)
  issue?: string;

  @Transform(({ value }) => toTrimmedString(value))
  @IsOptional()
  @IsString()
  @MinLength(7)
  phone?: string;

  @Transform(({ value }) => toOptionalBoolean(value))
  @IsOptional()
  @IsBoolean()
  emergency?: boolean;
}
