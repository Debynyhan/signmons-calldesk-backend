import { SanitizationService } from "../../../sanitization/sanitization.service";
import {
  buildAddressCandidateFromParts,
  compactAddressParts,
  extractAddressLocalityCorrection,
  extractAddressPartsFromCandidate,
  findStateTokenIndex,
  findZipTokenIndex,
  getAddressMissingParts,
  isIncompleteAddress,
  isLikelyAddressCandidate,
  isLikelyHouseNumberOnly,
  isLikelyStreetOnly,
  isMissingLocality,
  isStateToken,
  mergeAddressParts,
  mergeAddressWithLocality,
  normalizeAddressCandidate,
  parseLocalityParts,
  stripAddressLeadIn,
} from "../voice-address-candidate.policy";

describe("voice-address-candidate.policy", () => {
  const sanitizer = new SanitizationService();

  it("normalizes and strips address lead-ins", () => {
    const normalized = normalizeAddressCandidate(
      "  My   address is  123 Main St   ",
      sanitizer,
    );
    expect(normalized).toBe("My address is 123 Main St");
    expect(stripAddressLeadIn(normalized, sanitizer)).toBe("123 Main St");
  });

  it("detects likely address candidates", () => {
    expect(isLikelyAddressCandidate("123 Main St Cleveland OH")).toBe(true);
    expect(isLikelyAddressCandidate("Cleveland Ohio 44114")).toBe(true);
    expect(isLikelyAddressCandidate("hello there")).toBe(false);
  });

  it("detects house number and street-only fragments", () => {
    expect(isLikelyHouseNumberOnly("1234")).toBe(true);
    expect(isLikelyHouseNumberOnly("12A")).toBe(true);
    expect(isLikelyHouseNumberOnly("Main")).toBe(false);
    expect(isLikelyStreetOnly("Main Street")).toBe(true);
    expect(isLikelyStreetOnly("123 Main Street")).toBe(false);
  });

  it("parses address candidate into structured parts", () => {
    expect(
      extractAddressPartsFromCandidate(
        "123 Main St, Cleveland OH 44114",
        sanitizer,
      ),
    ).toEqual({
      houseNumber: "123",
      street: "Main St",
      city: "Cleveland",
      state: "OH",
      zip: "44114",
    });
  });

  it("parses locality parts and locality-only correction", () => {
    expect(parseLocalityParts("Cleveland OH 44114", sanitizer)).toEqual({
      city: "Cleveland",
      state: "OH",
      zip: "44114",
    });
    expect(
      extractAddressLocalityCorrection("Cleveland OH 44114", sanitizer),
    ).toEqual({
      city: "Cleveland",
      state: "OH",
      zip: "44114",
    });
    expect(extractAddressLocalityCorrection("yes", sanitizer)).toBeNull();
    expect(
      extractAddressLocalityCorrection("123 Main St Cleveland OH", sanitizer),
    ).toBeNull();
  });

  it("merges address parts and rebuilds candidate string", () => {
    const merged = mergeAddressParts(
      {
        candidate: "123 Main St",
        houseNumber: "123",
        street: "Main St",
        city: null,
        state: null,
        zip: null,
      },
      {
        city: "Cleveland",
        state: "OH",
        zip: "44114",
      },
    );
    expect(merged).toEqual({
      houseNumber: "123",
      street: "Main St",
      city: "Cleveland",
      state: "OH",
      zip: "44114",
    });
    expect(buildAddressCandidateFromParts(merged)).toBe(
      "123 Main St, Cleveland OH 44114",
    );
    expect(
      compactAddressParts({
        houseNumber: "123",
        street: "Main St",
        city: null,
      }),
    ).toEqual({
      houseNumber: "123",
      street: "Main St",
    });
  });

  it("detects incomplete addresses and missing locality", () => {
    expect(isIncompleteAddress("123")).toBe(true);
    expect(isIncompleteAddress("123 Main St")).toBe(false);
    expect(isMissingLocality("123 Main St")).toBe(true);
    expect(isMissingLocality("123 Main St Cleveland OH")).toBe(false);
    expect(isMissingLocality("123 Main St Cleveland OH 44114")).toBe(false);
  });

  it("provides missing-part guidance for structured state", () => {
    expect(
      getAddressMissingParts({
        candidate: null,
        houseNumber: "123",
        street: null,
        city: null,
        state: null,
        zip: null,
      }),
    ).toEqual({
      houseNumber: false,
      street: true,
      locality: true,
    });
    expect(
      getAddressMissingParts({
        candidate: null,
        houseNumber: "123",
        street: "Main St",
        city: "Cleveland",
        state: "OH",
        zip: null,
      }),
    ).toEqual({
      houseNumber: false,
      street: false,
      locality: false,
    });
  });

  it("handles state/zip token utilities and locality merge", () => {
    expect(isStateToken("oh")).toBe(true);
    expect(isStateToken("Ohio")).toBe(false);
    expect(findZipTokenIndex(["main", "st", "44114"])).toBe(2);
    expect(findStateTokenIndex(["cleveland", "oh", "44114"])).toBe(1);
    expect(mergeAddressWithLocality("123 Main St", "Cleveland OH 44114")).toBe(
      "123 Main St Cleveland OH 44114",
    );
  });
});
