import { Injectable } from "@nestjs/common";
import { normalizeConfirmationUtterance } from "./intake/voice-field-confirmation.policy";
import {
  isBookingIntent as isBookingIntentPolicy,
  isDuplicateTranscript as isDuplicateTranscriptPolicy,
  isFrustrationRequest as isFrustrationRequestPolicy,
  isHangupRequest as isHangupRequestPolicy,
  isHumanTransferRequest as isHumanTransferRequestPolicy,
  isLikelyQuestion as isLikelyQuestionPolicy,
  resolveBinaryUtterance as resolveBinaryUtterancePolicy,
  isSlowDownRequest as isSlowDownRequestPolicy,
  isSmsDifferentNumberRequest as isSmsDifferentNumberRequestPolicy,
} from "./voice-utterance.policy";

@Injectable()
export class VoiceUtteranceService {
  isLikelyQuestion(transcript: string): boolean {
    return isLikelyQuestionPolicy(transcript);
  }

  isBookingIntent(transcript: string): boolean {
    return isBookingIntentPolicy(this.normalize(transcript));
  }

  isSlowDownRequest(transcript: string): boolean {
    return isSlowDownRequestPolicy(this.normalize(transcript));
  }

  isFrustrationRequest(transcript: string): boolean {
    return isFrustrationRequestPolicy(this.normalize(transcript));
  }

  isHumanTransferRequest(transcript: string): boolean {
    return isHumanTransferRequestPolicy(this.normalize(transcript));
  }

  isSmsDifferentNumberRequest(transcript: string): boolean {
    return isSmsDifferentNumberRequestPolicy(this.normalize(transcript));
  }

  isHangupRequest(transcript: string): boolean {
    return isHangupRequestPolicy(this.normalize(transcript));
  }

  resolveBinaryUtterance(transcript: string): "YES" | "NO" | null {
    return resolveBinaryUtterancePolicy(this.normalize(transcript));
  }

  isDuplicateTranscript(
    collectedData: unknown,
    transcript: string,
    now: Date,
  ): boolean {
    return isDuplicateTranscriptPolicy(collectedData, transcript, now);
  }

  private normalize(transcript: string): string {
    return normalizeConfirmationUtterance(transcript);
  }
}
