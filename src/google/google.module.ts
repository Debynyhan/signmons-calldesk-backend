import { Module } from "@nestjs/common";
import { GoogleSpeechService } from "./google-speech.service";
import { GoogleTtsService } from "./google-tts.service";

@Module({
  providers: [GoogleSpeechService, GoogleTtsService],
  exports: [GoogleSpeechService, GoogleTtsService],
})
export class GoogleModule {}
