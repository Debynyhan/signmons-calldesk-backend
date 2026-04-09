import { MODULE_METADATA } from "@nestjs/common/constants";
import { AiModule } from "../../ai/ai.module";
import { PaymentsModule } from "../../payments/payments.module";
import { SmsModule } from "../../sms/sms.module";
import { VoiceModule } from "../../voice/voice.module";
import { ConversationsModule } from "../conversations.module";
import { ConversationsService } from "../conversations.service";

type ModuleClass = new (...args: never[]) => unknown;

const modulesUsingConversations: ModuleClass[] = [
  AiModule,
  VoiceModule,
  SmsModule,
  PaymentsModule,
];

describe("Conversations module boundary", () => {
  it.each(modulesUsingConversations)(
    "%p imports ConversationsModule",
    (moduleClass) => {
      const imports =
        (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) as
          | unknown[]
          | undefined) ?? [];
      expect(imports).toContain(ConversationsModule);
    },
  );

  it.each(modulesUsingConversations)(
    "%p does not provide ConversationsService directly",
    (moduleClass) => {
      const providers =
        (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleClass) as
          | unknown[]
          | undefined) ?? [];
      expect(providers).not.toContain(ConversationsService);
    },
  );
});
