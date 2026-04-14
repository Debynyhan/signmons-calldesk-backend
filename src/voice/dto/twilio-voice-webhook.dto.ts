import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class TwilioVoiceWebhookDto {
  @IsString()
  @IsNotEmpty()
  CallSid: string;

  @IsString()
  @IsOptional()
  To?: string;

  @IsString()
  @IsOptional()
  From?: string;

  @IsString()
  @IsOptional()
  SpeechResult?: string;

  @IsString()
  @IsOptional()
  Confidence?: string;
}
