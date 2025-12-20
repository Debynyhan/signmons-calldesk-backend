export type CallDeskStep =
  | "GREETING"
  | "CATEGORY"
  | "URGENCY"
  | "INFO_COLLECTION"
  | "PRICING"
  | "UPSELL"
  | "BOOKING"
  | "CLOSEOUT";

export type CallDeskCategory =
  | "HEATING"
  | "COOLING"
  | "PLUMBING"
  | "ELECTRICAL"
  | "DRAINS"
  | "GENERAL_HANDYMAN_CONSTRUCTION";

export type CallDeskUrgency = "EMERGENCY" | "HIGH_PRIORITY" | "STANDARD";

export interface BookingFields {
  name?: string;
  phone?: string;
  address?: string;
  issue?: string;
  photos?: boolean;
  preferred_window?: string;
}

export interface CallDeskSessionState {
  step: CallDeskStep;
  category?: CallDeskCategory | null;
  urgency?: CallDeskUrgency | null;
  urgency_acknowledged: boolean;
  fields: BookingFields;
  fee_disclosed: boolean;
  fee_confirmed: boolean;
  upsell_offered: boolean;
  emergency_flagged: boolean;
  name_acknowledged: boolean;
  address_confirmed: boolean;
  empathy_used: boolean;
  last_captured_field?: keyof BookingFields | null;
  last_requested_field?: keyof BookingFields | null;
}

export const REQUIRED_FOR_BOOKING: (keyof BookingFields)[] = [
  "name",
  "phone",
  "address",
  "issue",
  "preferred_window",
];

export function missingFields(
  state: CallDeskSessionState,
): (keyof BookingFields)[] {
  return REQUIRED_FOR_BOOKING.filter((field) => {
    if (field === "address") {
      return !state.fields.address || !state.address_confirmed;
    }
    if (field === "name") {
      return !hasFullName(state.fields.name);
    }
    return !state.fields[field];
  });
}

export const INFO_COLLECTION_ORDER: (keyof BookingFields)[] = [
  "phone",
  "name",
  "address",
  "issue",
  "preferred_window",
];

export function missingInfoFields(
  state: CallDeskSessionState,
): (keyof BookingFields)[] {
  return INFO_COLLECTION_ORDER.filter((field) => {
    if (field === "address") {
      return !state.fields.address || !state.address_confirmed;
    }
    if (field === "name") {
      return !hasFullName(state.fields.name);
    }
    return !state.fields[field];
  });
}

export function hasFullName(name?: string): boolean {
  if (!name) {
    return false;
  }
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  return tokens.length >= 2;
}

export const ALLOWED_TRANSITIONS: Record<CallDeskStep, CallDeskStep[]> = {
  GREETING: ["CATEGORY"],
  CATEGORY: ["URGENCY"],
  URGENCY: ["INFO_COLLECTION"],
  INFO_COLLECTION: ["INFO_COLLECTION", "PRICING", "BOOKING"],
  PRICING: ["UPSELL", "BOOKING"],
  UPSELL: ["BOOKING"],
  BOOKING: ["CLOSEOUT"],
  CLOSEOUT: ["CLOSEOUT"],
};

export function canTransition(from: CallDeskStep, to: CallDeskStep): boolean {
  if (from === to) {
    return true;
  }
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
