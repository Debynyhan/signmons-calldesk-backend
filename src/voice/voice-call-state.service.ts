import { Injectable } from "@nestjs/common";

@Injectable()
export class VoiceCallStateService {
  private readonly lastResponseByCall = new Map<
    string,
    { twiml: string; at: number }
  >();
  private readonly issuePromptAttemptsByCall = new Map<string, number>();

  shouldSuppressDuplicateResponse(callSid: string, twiml: string): boolean {
    const now = Date.now();
    const last = this.lastResponseByCall.get(callSid);
    if (last && last.twiml === twiml && now - last.at < 2000) {
      return true;
    }
    this.lastResponseByCall.set(callSid, { twiml, at: now });
    return false;
  }

  getIssuePromptAttempts(callSid: string): number {
    return this.issuePromptAttemptsByCall.get(callSid) ?? 0;
  }

  setIssuePromptAttempts(callSid: string, count: number): void {
    this.issuePromptAttemptsByCall.set(callSid, count);
  }

  clearIssuePromptAttempts(callSid: string | undefined): void {
    if (!callSid) {
      return;
    }
    this.issuePromptAttemptsByCall.delete(callSid);
  }
}
