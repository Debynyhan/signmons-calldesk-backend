import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { LoggingService } from "../logging/logging.service";
import type { ConversationsService } from "../conversations/conversations.service";
import { CsrStrategy } from "./csr-strategy.selector";

type VoiceNameState = ReturnType<ConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<ConversationsService["getVoiceAddressState"]>;
type VoiceSmsPhoneState = ReturnType<
  ConversationsService["getVoiceSmsPhoneState"]
>;

export type VoiceListeningField =
  | "name"
  | "address"
  | "confirmation"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

export type VoiceExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

type VoiceListeningWindowLike = {
  field: VoiceListeningField;
  sourceEventId: string | null;
  expiresAt: string;
  targetField?:
    | "name"
    | "address"
    | "booking"
    | "callback"
    | "comfort_risk"
    | "urgency_confirm";
};

type TurnContextPolicy = {
  getVoiceNameState: (collectedData: Prisma.JsonValue | null) => VoiceNameState;
  getVoiceSmsPhoneState: (
    collectedData: Prisma.JsonValue | null,
  ) => VoiceSmsPhoneState;
  getVoiceAddressState: (
    collectedData: Prisma.JsonValue | null,
  ) => VoiceAddressState;
  selectCsrStrategy: (params: {
    conversation: { currentFSMState?: string | null };
    collectedData: Prisma.JsonValue | null;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
  }) => CsrStrategy;
  normalizeCsrStrategyForTurn: (
    strategy: CsrStrategy,
    turnCount: number,
  ) => CsrStrategy | undefined;
  getVoiceListeningWindow: (
    collectedData: Prisma.JsonValue | null,
  ) => VoiceListeningWindowLike | null;
  shouldClearListeningWindow: (
    listeningWindow: VoiceListeningWindowLike,
    now: Date,
    nameState: VoiceNameState,
    addressState: VoiceAddressState,
    phoneState: VoiceSmsPhoneState,
  ) => boolean;
  clearVoiceListeningWindow: (params: {
    tenantId: string;
    conversationId: string;
  }) => Promise<void>;
  getVoiceLastEventId: (collectedData: Prisma.JsonValue | null) => string | null;
  replyWithTwiml: (res: Response | undefined, twiml: string) => Promise<string>;
  buildListeningWindowReprompt: (params: {
    window: VoiceListeningWindowLike | null;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    phoneState: VoiceSmsPhoneState;
    strategy?: CsrStrategy;
  }) => string;
  markVoiceEventProcessed: (params: {
    tenantId: string;
    conversationId: string;
    eventId: string;
  }) => Promise<void>;
  getExpectedListeningField: (
    window: VoiceListeningWindowLike | null,
  ) => VoiceExpectedField | null;
  isVoiceFieldReady: (
    locked: boolean,
    confirmed: string | null,
  ) => boolean;
};

type TurnContextInput = {
  res?: Response;
  tenantId: string;
  conversationId: string;
  currentEventId: string;
  voiceTurnCount: number;
  now: Date;
  collectedData: Prisma.JsonValue | null;
  conversationForStrategy: { currentFSMState?: string | null };
  conversationCurrentFsmState?: string | null;
};

type TurnContextReady = {
  kind: "ready";
  nameState: VoiceNameState;
  phoneState: VoiceSmsPhoneState;
  addressState: VoiceAddressState;
  csrStrategy: CsrStrategy | undefined;
  listeningWindow: VoiceListeningWindowLike | null;
  expectedField: VoiceExpectedField | null;
  nameReady: boolean;
  addressReady: boolean;
};

type TurnContextExit = {
  kind: "exit";
  value: string;
};

export type TurnContextResult = TurnContextReady | TurnContextExit;

export class VoiceTurnContextRuntime {
  constructor(
    private readonly loggingService: LoggingService,
    private readonly policy: TurnContextPolicy,
  ) {}

  async prepareTurnContext(input: TurnContextInput): Promise<TurnContextResult> {
    let nameState = this.policy.getVoiceNameState(input.collectedData);
    const phoneState = this.policy.getVoiceSmsPhoneState(input.collectedData);
    const addressState = this.policy.getVoiceAddressState(input.collectedData);

    const rawCsrStrategy = this.policy.selectCsrStrategy({
      conversation: input.conversationForStrategy,
      collectedData: input.collectedData,
      nameState,
      addressState,
    });
    const csrStrategy = this.policy.normalizeCsrStrategyForTurn(
      rawCsrStrategy,
      input.voiceTurnCount,
    );
    this.loggingService.log(
      {
        event: "voice.strategy_selected",
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        strategy: csrStrategy ?? "NONE",
        rawStrategy: rawCsrStrategy,
        fsmState: input.conversationCurrentFsmState ?? null,
      },
      "VoiceTurnService",
    );

    let listeningWindow = this.policy.getVoiceListeningWindow(input.collectedData);
    if (
      listeningWindow &&
      this.policy.shouldClearListeningWindow(
        listeningWindow,
        input.now,
        nameState,
        addressState,
        phoneState,
      )
    ) {
      await this.policy.clearVoiceListeningWindow({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      });
      listeningWindow = null;
    }

    const lastEventId = this.policy.getVoiceLastEventId(input.collectedData);
    if (lastEventId && lastEventId === input.currentEventId) {
      return {
        kind: "exit",
        value: await this.policy.replyWithTwiml(
          input.res,
          this.policy.buildListeningWindowReprompt({
            window: listeningWindow,
            nameState,
            addressState,
            phoneState,
            strategy: csrStrategy,
          }),
        ),
      };
    }

    await this.policy.markVoiceEventProcessed({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      eventId: input.currentEventId,
    });

    let expectedField = this.policy.getExpectedListeningField(listeningWindow);
    let nameReady =
      Boolean(nameState.confirmed.value) ||
      this.policy.isVoiceFieldReady(nameState.locked, nameState.confirmed.value);
    const addressDeferred = Boolean(addressState.smsConfirmNeeded);
    const addressReady =
      Boolean(addressState.confirmed) ||
      this.policy.isVoiceFieldReady(addressState.locked, addressState.confirmed) ||
      addressDeferred;

    if (expectedField === "name" && nameReady) {
      await this.policy.clearVoiceListeningWindow({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      });
      expectedField = null;
    }
    if (
      expectedField === "address" &&
      !nameReady &&
      nameState.attemptCount === 0
    ) {
      await this.policy.clearVoiceListeningWindow({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      });
      expectedField = null;
    }

    return {
      kind: "ready",
      nameState,
      phoneState,
      addressState,
      csrStrategy,
      listeningWindow,
      expectedField,
      nameReady,
      addressReady,
    };
  }
}
