import { PiiObfuscatorService } from "../pii-obfuscator.service";

describe("PiiObfuscatorService", () => {
  const service = new PiiObfuscatorService();

  describe("phone number masking", () => {
    it("masks a standard 10-digit phone number", () => {
      expect(service.obfuscate("Call me at 2165551234")).toBe(
        "Call me at ***-***-1234",
      );
    });

    it("masks a phone with dashes", () => {
      expect(service.obfuscate("number is 216-555-1234")).toBe(
        "number is ***-***-1234",
      );
    });

    it("masks a phone with dots", () => {
      expect(service.obfuscate("216.555.1234")).toBe("***-***-1234");
    });

    it("masks a phone with country code (+ prefix is not a word character so it is not consumed by the pattern)", () => {
      expect(service.obfuscate("+1 216 555 1234")).toBe("+***-***-1234");
    });

    it("masks multiple phone numbers in one string", () => {
      const result = service.obfuscate("call 2165551234 or 3305559876");
      expect(result).toBe("call ***-***-1234 or ***-***-9876");
    });

    it("does not alter a string with no phone number", () => {
      expect(service.obfuscate("no phone here")).toBe("no phone here");
    });
  });

  describe("address masking", () => {
    it("masks a street address with Street suffix", () => {
      expect(service.obfuscate("I live at 123 Main Street")).toBe(
        "I live at *** Main Street",
      );
    });

    it("masks a street address with abbreviated suffix", () => {
      expect(service.obfuscate("come to 456 Oak Ave")).toBe(
        "come to *** Oak Ave",
      );
    });

    it("masks a Drive address", () => {
      expect(service.obfuscate("send to 789 Elm Drive")).toBe(
        "send to *** Elm Drive",
      );
    });

    it("does not alter a string with no address", () => {
      expect(service.obfuscate("meet at the park")).toBe("meet at the park");
    });
  });

  describe("combined content", () => {
    it("masks both a phone and an address in the same string", () => {
      const result = service.obfuscate(
        "caller at 123 Main Street, phone 2165551234",
      );
      expect(result).toContain("*** Main Street");
      expect(result).toContain("***-***-1234");
    });
  });

  describe("edge cases", () => {
    it("returns an empty string unchanged", () => {
      expect(service.obfuscate("")).toBe("");
    });

    it("returns a string with only whitespace unchanged", () => {
      expect(service.obfuscate("   ")).toBe("   ");
    });
  });
});
