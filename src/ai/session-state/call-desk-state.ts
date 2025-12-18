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
  fields: BookingFields;
  fee_disclosed: boolean;
  upsell_offered: boolean;
  emergency_flagged: boolean;
}

export const REQUIRED_FOR_BOOKING: (keyof BookingFields)[] = [
  "name",
  "phone",
  "issue",
  "preferred_window",
];

export function missingFields(
  state: CallDeskSessionState,
): (keyof BookingFields)[] {
  return REQUIRED_FOR_BOOKING.filter((field) => !state.fields[field]);
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
