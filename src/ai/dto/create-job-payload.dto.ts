import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

const ISSUE_CATEGORIES = [
  "HEATING",
  "COOLING",
  "PLUMBING",
  "ELECTRICAL",
  "DRAINS",
  "GENERAL",
] as const;

type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

type Urgency = "EMERGENCY" | "HIGH" | "STANDARD";

export class CreateJobPayloadDto {
  @IsString()
  @MaxLength(120)
  customerName!: string;

  @IsString()
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsEnum(ISSUE_CATEGORIES, {
    message: `issueCategory must be one of: ${ISSUE_CATEGORIES.join(", ")}`,
  })
  issueCategory!: IssueCategory;

  @IsEnum(["EMERGENCY", "HIGH", "STANDARD"], {
    message: "urgency must be EMERGENCY, HIGH, or STANDARD",
  })
  urgency!: Urgency;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  preferredTime?: string;
}
