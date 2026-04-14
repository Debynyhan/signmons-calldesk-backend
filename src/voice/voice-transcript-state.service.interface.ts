export const VOICE_TRANSCRIPT_STATE_SERVICE = "VOICE_TRANSCRIPT_STATE_SERVICE";

export interface IVoiceTranscriptState {
  updateVoiceTranscript(params: {
    tenantId: string;
    callSid: string;
    transcript: string;
    confidence?: number;
  }): Promise<unknown>;
}
