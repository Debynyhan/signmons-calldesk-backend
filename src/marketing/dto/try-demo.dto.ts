import { Transform, TransformFnParams } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

const trimToString = ({ value }: TransformFnParams): string =>
  typeof value === "string" ? value.trim() : "";

const trimToOptionalString = ({
  value,
}: TransformFnParams): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const lowerToOptionalString = ({
  value,
}: TransformFnParams): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
};

export class TryDemoDto {
  @Transform(trimToString)
  @IsString()
  phone!: string;

  @IsBoolean()
  consentToAutoCall!: boolean;

  @Transform(trimToString)
  @IsString()
  consentTextVersion!: string;

  @Transform(trimToOptionalString)
  @IsOptional()
  @IsString()
  name?: string;

  @Transform(trimToOptionalString)
  @IsOptional()
  @IsString()
  company?: string;

  @Transform(lowerToOptionalString)
  @IsOptional()
  @IsEmail()
  email?: string;

  @Transform(lowerToOptionalString)
  @IsOptional()
  @IsIn(["hvac", "plumbing", "electrical"])
  demoScenario?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  preferredCallTime?: string;

  @IsOptional()
  @IsObject()
  utm?: Record<string, unknown>;

  @Transform(trimToOptionalString)
  @IsOptional()
  @IsString()
  referrerUrl?: string;
}
