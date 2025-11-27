import { IsString, Length } from "class-validator";

export class TriageDto {
  @IsString()
  @Length(1, 100)
  tenantId!: string;

  @IsString()
  @Length(1, 1000)
  message!: string;
}
