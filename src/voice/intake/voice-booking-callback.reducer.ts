export type VoiceBookingCallbackExpectedField = "booking" | "callback" | null;

export type VoiceBookingCallbackInput = {
  expectedField: VoiceBookingCallbackExpectedField;
  binaryIntent: "YES" | "NO" | null;
  hasBookingIntent: boolean;
};

export type VoiceBookingCallbackAction =
  | { type: "NONE" }
  | { type: "CLEAR_AND_CONTINUE" }
  | { type: "BOOKING_DECLINED" }
  | { type: "REPROMPT_BOOKING" }
  | { type: "CALLBACK_REQUESTED" }
  | { type: "CALLBACK_DECLINED" }
  | { type: "REPROMPT_CALLBACK" };

export function reduceBookingCallbackSlot(
  input: VoiceBookingCallbackInput,
): VoiceBookingCallbackAction {
  if (input.expectedField === "booking") {
    const isYes = input.binaryIntent === "YES" || input.hasBookingIntent;
    if (isYes) {
      return { type: "CLEAR_AND_CONTINUE" };
    }
    if (input.binaryIntent === "NO") {
      return { type: "BOOKING_DECLINED" };
    }
    return { type: "REPROMPT_BOOKING" };
  }
  if (input.expectedField === "callback") {
    if (input.binaryIntent === "YES") {
      return { type: "CALLBACK_REQUESTED" };
    }
    if (input.binaryIntent === "NO") {
      return { type: "CALLBACK_DECLINED" };
    }
    return { type: "REPROMPT_CALLBACK" };
  }
  return { type: "NONE" };
}
