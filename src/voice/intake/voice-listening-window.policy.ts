type VoiceListeningField =
  | "name"
  | "address"
  | "confirmation"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

type VoiceExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

type VoiceListeningWindow = {
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

type VoiceNameWindowState = {
  locked: boolean;
  attemptCount: number;
};

type VoiceAddressWindowState = {
  locked: boolean;
  status: string;
  attemptCount: number;
};

type VoiceSmsPhoneWindowState = {
  confirmed: boolean;
  attemptCount: number;
};

export function isVoiceListeningWindowExpired(
  window: VoiceListeningWindow,
  now: Date,
): boolean {
  const expiresAt = Date.parse(window.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt <= now.getTime();
}

export function getExpectedVoiceListeningField(
  window: VoiceListeningWindow | null,
): VoiceExpectedField | null {
  if (!window) {
    return null;
  }
  if (window.field === "confirmation") {
    return window.targetField ?? null;
  }
  return window.field;
}

export function shouldClearVoiceListeningWindow(params: {
  window: VoiceListeningWindow;
  now: Date;
  nameState: VoiceNameWindowState;
  addressState: VoiceAddressWindowState;
  phoneState: VoiceSmsPhoneWindowState;
}): boolean {
  if (isVoiceListeningWindowExpired(params.window, params.now)) {
    return true;
  }
  const expectedField = getExpectedVoiceListeningField(params.window);
  if (expectedField === "name") {
    return params.nameState.locked || params.nameState.attemptCount >= 3;
  }
  if (expectedField === "address") {
    return (
      params.addressState.locked ||
      params.addressState.status === "FAILED" ||
      params.addressState.attemptCount >= 2
    );
  }
  if (expectedField === "sms_phone") {
    return params.phoneState.confirmed || params.phoneState.attemptCount >= 2;
  }
  if (
    expectedField === "booking" ||
    expectedField === "callback" ||
    expectedField === "comfort_risk" ||
    expectedField === "urgency_confirm"
  ) {
    return isVoiceListeningWindowExpired(params.window, params.now);
  }
  return false;
}

export function buildVoiceListeningWindowReprompt<TAddressState>(params: {
  window: VoiceListeningWindow | null;
  addressState: TAddressState;
  strategy?: unknown;
  buildAskNameTwiml: (strategy?: unknown) => string;
  buildAddressPromptForState: (addressState: TAddressState, strategy?: unknown) => string;
  buildAskSmsNumberTwiml: (strategy?: unknown) => string;
  buildBookingPromptTwiml: (strategy?: unknown) => string;
  buildCallbackOfferTwiml: (strategy?: unknown) => string;
  buildUrgencyConfirmTwiml: (strategy?: unknown) => string;
  buildRepromptTwiml: (strategy?: unknown) => string;
}): string {
  const expectedField = getExpectedVoiceListeningField(params.window);
  if (expectedField === "name") {
    return params.buildAskNameTwiml(params.strategy);
  }
  if (expectedField === "address") {
    return params.buildAddressPromptForState(
      params.addressState,
      params.strategy,
    );
  }
  if (expectedField === "sms_phone") {
    return params.buildAskSmsNumberTwiml(params.strategy);
  }
  if (expectedField === "booking") {
    return params.buildBookingPromptTwiml(params.strategy);
  }
  if (expectedField === "callback") {
    return params.buildCallbackOfferTwiml(params.strategy);
  }
  if (expectedField === "comfort_risk" || expectedField === "urgency_confirm") {
    return params.buildUrgencyConfirmTwiml(params.strategy);
  }
  return params.buildRepromptTwiml(params.strategy);
}
