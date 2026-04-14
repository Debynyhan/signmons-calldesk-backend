import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class TwilioSmsWebhookDto {
  @IsString()
  @IsNotEmpty()
  From!: string;

  @IsString()
  @IsNotEmpty()
  To!: string;

  @IsString()
  @IsOptional()
  Body?: string;

  @IsString()
  @IsOptional()
  SmsSid?: string;

  @IsString()
  @IsOptional()
  MessageSid?: string;
}
