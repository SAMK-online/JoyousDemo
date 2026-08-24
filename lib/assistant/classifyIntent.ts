import {
  checkSafetyOverride,
  isDoseChangeRequest,
  isUrgentMedicalMessage,
} from "@/lib/assistant/guardrails";

export type PatientIntent =
  | "crisis"
  | "third_party_safety"
  | "urgent_medical"
  | "shipment"
  | "billing"
  | "appointment"
  | "checkin"
  | "side_effect"
  | "form"
  | "dose"
  | "next_step"
  | "getting_started"
  | "overview";

function matches(message: string, pattern: RegExp): boolean {
  return pattern.test(message);
}

export function classifyIntent(message: string): PatientIntent {
  const normalized = message.trim().toLowerCase();
  const safety = checkSafetyOverride(normalized);

  if (safety.override) return "crisis";
  if (safety.flagForReview) return "third_party_safety";
  if (isUrgentMedicalMessage(normalized)) return "urgent_medical";
  if (isDoseChangeRequest(normalized)) return "dose";
  if (matches(normalized, /ship|package|deliver|tracking|refill|arrive|run out|mail/)) {
    return "shipment";
  }
  if (matches(normalized, /charg|billing|bill\b|payment|refund|subscription|cost|cancel/)) {
    return "billing";
  }
  if (matches(normalized, /\bdose\b|\bmg\b|troche|titrat/)) {
    return "dose";
  }
  if (matches(normalized, /prescri|approv|deny|deni|declin/)) {
    return "next_step";
  }
  if (matches(normalized, /appointment|visit|provider|meeting|book|schedule/)) {
    return "appointment";
  }
  if (matches(normalized, /how (?:does|do|will) (?:joyous|treatment)|getting started|how it works|begin treatment/)) {
    return "getting_started";
  }
  if (matches(normalized, /check[ -]?in|phq|gad|score|progress|working|improv|feel(?:ing)? better/)) {
    return "checkin";
  }
  if (matches(normalized, /side effect|nausea|queasy|headache|dizz|tired|sleep|floaty/)) {
    return "side_effect";
  }
  if (matches(normalized, /form|intake|photo id|government id|identity|upload/)) {
    return "form";
  }
  if (matches(normalized, /dose|\bmg\b|troche|medication|take more|take less|restart/)) {
    return "dose";
  }
  if (matches(normalized, /next|need to do|waiting on|blocked|status|approved|approval/)) {
    return "next_step";
  }
  return "overview";
}
