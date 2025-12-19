import {
  parsePreferredWindow,
  stringifyPreferredWindow,
} from "./state-helpers";

describe("preferred window parser", () => {
  test("any time today", () => {
    const parsed = parsePreferredWindow("any time today");
    expect(stringifyPreferredWindow(parsed)).toBe("today anytime");
  });

  test("today any time after 12 pm", () => {
    const parsed = parsePreferredWindow("today any time after 12 pm");
    expect(stringifyPreferredWindow(parsed)).toBe("today after 12:00");
  });

  test("this afternoon", () => {
    const parsed = parsePreferredWindow("this afternoon");
    expect(stringifyPreferredWindow(parsed)).toBe("today afternoon");
  });

  test("tomorrow morning", () => {
    const parsed = parsePreferredWindow("tomorrow morning");
    expect(stringifyPreferredWindow(parsed)).toBe("tomorrow morning");
  });

  test("Fri between 1 and 3", () => {
    const parsed = parsePreferredWindow("Fri between 1 and 3");
    expect(stringifyPreferredWindow(parsed)).toBe(
      "fri between 01:00 and 03:00",
    );
  });

  test("12/19 at noon", () => {
    const parsed = parsePreferredWindow("12/19 at noon");
    expect(stringifyPreferredWindow(parsed)).toBe("12/19 12:00");
  });

  test("ASAP", () => {
    const parsed = parsePreferredWindow("ASAP");
    expect(stringifyPreferredWindow(parsed)).toBe("ASAP");
  });

  test("after 5", () => {
    const parsed = parsePreferredWindow("after 5");
    expect(stringifyPreferredWindow(parsed)).toBe("after 05:00");
  });
});
