import { reduceBookingCallbackSlot } from "../voice-booking-callback.reducer";

describe("voice booking/callback reducer", () => {
  it("clears and continues when booking is affirmed", () => {
    const action = reduceBookingCallbackSlot({
      expectedField: "booking",
      binaryIntent: "YES",
      hasBookingIntent: false,
    });
    expect(action).toEqual({ type: "CLEAR_AND_CONTINUE" });
  });

  it("treats booking intent language as yes for booking slot", () => {
    const action = reduceBookingCallbackSlot({
      expectedField: "booking",
      binaryIntent: null,
      hasBookingIntent: true,
    });
    expect(action).toEqual({ type: "CLEAR_AND_CONTINUE" });
  });

  it("returns booking declined action on explicit no", () => {
    const action = reduceBookingCallbackSlot({
      expectedField: "booking",
      binaryIntent: "NO",
      hasBookingIntent: false,
    });
    expect(action).toEqual({ type: "BOOKING_DECLINED" });
  });

  it("reprompts booking when answer is ambiguous", () => {
    const action = reduceBookingCallbackSlot({
      expectedField: "booking",
      binaryIntent: null,
      hasBookingIntent: false,
    });
    expect(action).toEqual({ type: "REPROMPT_BOOKING" });
  });

  it("returns callback requested action on yes", () => {
    const action = reduceBookingCallbackSlot({
      expectedField: "callback",
      binaryIntent: "YES",
      hasBookingIntent: false,
    });
    expect(action).toEqual({ type: "CALLBACK_REQUESTED" });
  });

  it("returns callback declined action on no", () => {
    const action = reduceBookingCallbackSlot({
      expectedField: "callback",
      binaryIntent: "NO",
      hasBookingIntent: false,
    });
    expect(action).toEqual({ type: "CALLBACK_DECLINED" });
  });

  it("reprompts callback when answer is ambiguous", () => {
    const action = reduceBookingCallbackSlot({
      expectedField: "callback",
      binaryIntent: null,
      hasBookingIntent: false,
    });
    expect(action).toEqual({ type: "REPROMPT_CALLBACK" });
  });

  it("returns NONE when field is unrelated", () => {
    const action = reduceBookingCallbackSlot({
      expectedField: null,
      binaryIntent: "YES",
      hasBookingIntent: true,
    });
    expect(action).toEqual({ type: "NONE" });
  });
});
