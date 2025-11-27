import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';

class TriageRequestDto {
  tenantId!: string;
  message!: string;
}

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('triage')
  async triage(@Body() body: TriageRequestDto) {
    const { tenantId, message } = body;

    if (!tenantId || !message) {
      return { error: 'tenantId and message are required' };
    }

    return this.aiService.triage(tenantId, message);
  }
}
