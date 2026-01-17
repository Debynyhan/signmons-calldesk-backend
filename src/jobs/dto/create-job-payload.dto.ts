import { Transform, TransformFnParams } from "class-transformer";
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

const ISSUE_CATEGORIES = [
  "HEATING",
  "COOLING",
  "PLUMBING",
  "ELECTRICAL",
  "GENERAL",
] as const;

type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

type Urgency = "EMERGENCY" | "STANDARD";

const transformRequiredString = ({ value }: TransformFnParams): string =>
  typeof value === "string" ? value.trim() : "";

const transformOptionalString = ({
  value,
}: TransformFnParams): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

export class CreateJobPayloadDto {
  @Transform(transformRequiredString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  customerName!: string;

  @Transform(transformRequiredString)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  phone!: string;

  @Transform(transformOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsEnum(ISSUE_CATEGORIES, {
    message: `issueCategory must be one of: ${ISSUE_CATEGORIES.join(", ")}`,
  })
  issueCategory!: IssueCategory;

  @IsEnum(["EMERGENCY", "STANDARD"], {
    message: "urgency must be EMERGENCY or STANDARD",
  })
  urgency!: Urgency;

  @Transform(transformOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @Transform(transformOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  preferredTime?: string;
}
