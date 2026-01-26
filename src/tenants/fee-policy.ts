export type FeePolicyInput = {
  serviceFeeCents: number;
  emergencyFeeCents: number;
  creditWindowHours: number;
  currency: string;
};

export const DEFAULT_FEE_POLICY: FeePolicyInput = {
  serviceFeeCents: 15000,
  emergencyFeeCents: 9900,
  creditWindowHours: 24,
  currency: "USD",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (!cleaned) {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readNumber = (settings: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) {
      continue;
    }
    const parsed = parseNumber(settings[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
};

const readCurrency = (settings: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toUpperCase();
    }
  }
  return null;
};

const toCents = (value: number) => Math.round(value * 100);

const readCents = (settings: Record<string, unknown>, keys: string[]) => {
  const value = readNumber(settings, keys);
  if (value === null) {
    return null;
  }
  return Math.round(value);
};

const readDollarsToCents = (settings: Record<string, unknown>, keys: string[]) => {
  const value = readNumber(settings, keys);
  if (value === null) {
    return null;
  }
  return toCents(value);
};

export const normalizeFeePolicyFromSettings = (
  settings: unknown,
  defaults: FeePolicyInput = DEFAULT_FEE_POLICY,
): FeePolicyInput => {
  const root = isRecord(settings) ? settings : {};
  const fees = isRecord(root.fees) ? root.fees : root;

  const serviceFeeCents =
    readCents(fees, ["serviceFeeCents", "diagnosticFeeCents"]) ??
    readDollarsToCents(fees, ["serviceFee", "diagnosticFee"]) ??
    defaults.serviceFeeCents;

  const emergencyFeeCents =
    readCents(fees, ["emergencyFeeCents"]) ??
    readDollarsToCents(fees, ["emergencyFee"]) ??
    defaults.emergencyFeeCents;

  const creditWindowHours =
    readNumber(fees, ["creditWindowHours"]) ?? defaults.creditWindowHours;

  const currency =
    readCurrency(fees, ["currency"]) ?? defaults.currency;

  return {
    serviceFeeCents: Math.max(0, Math.round(serviceFeeCents)),
    emergencyFeeCents: Math.max(0, Math.round(emergencyFeeCents)),
    creditWindowHours: Math.max(1, Math.round(creditWindowHours)),
    currency,
  };
};
