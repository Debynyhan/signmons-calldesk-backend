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

  // Twilio SMS webhook envelope fields (accepted but not required).
  @IsString()
  @IsOptional()
  AccountSid?: string;

  @IsString()
  @IsOptional()
  ApiVersion?: string;

  @IsString()
  @IsOptional()
  MessagingServiceSid?: string;

  @IsString()
  @IsOptional()
  SmsMessageSid?: string;

  @IsString()
  @IsOptional()
  SmsStatus?: string;

  @IsString()
  @IsOptional()
  NumMedia?: string;

  @IsString()
  @IsOptional()
  NumSegments?: string;

  @IsString()
  @IsOptional()
  ToCity?: string;

  @IsString()
  @IsOptional()
  ToState?: string;

  @IsString()
  @IsOptional()
  ToZip?: string;

  @IsString()
  @IsOptional()
  ToCountry?: string;

  @IsString()
  @IsOptional()
  FromCity?: string;

  @IsString()
  @IsOptional()
  FromState?: string;

  @IsString()
  @IsOptional()
  FromZip?: string;

  @IsString()
  @IsOptional()
  FromCountry?: string;

  @IsString()
  @IsOptional()
  OptOutType?: string;
}
