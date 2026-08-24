export type SafetyReviewReason = "third_party_suicide_loss" | "third_party_suicide_risk";

export interface SafetyOverrideResult {
  override: boolean;
  flagForReview: boolean;
  reason?: "self_harm_risk" | SafetyReviewReason;
}

const selfRiskPatterns = [
  /\bkill myself\b/i,
  /\bend my life\b/i,
  /\b(?:harm|hurt)(?:ing)? myself\b/i,
  /\bself[- ]?harm(?:ing)?\b/i,
  /\b(?:i(?:'m| am)?|i feel|i have been feeling)\b[^.!?\n]{0,60}\bsuicidal\b/i,
  /\b(?:i|i'm|i am|im)\b[^.!?\n]{0,80}\b(?:want to die|thinking about suicide|going to hurt myself)\b/i,
  /\bi (?:do not|don'?t) want to (?:be here|live)\b/i,
  /\bi (?:can'?t|cannot) stay safe\b/i,
  /\bi (?:am|'m|feel) not safe with myself\b/i,
  /\bi (?:am|'m|feel|would be) better off dead\b/i,
  /\bi wish i (?:was|were) dead\b/i,
  /\bi have no reason to live\b/i,
  /\bi(?:'m| am) ending it\b/i,
  /\bi plan to die\b/i,
  /\bi(?:'m| am| have been| was)?[^.!?\n]{0,40}\boverdos(?:e|ed|ing) myself\b/i,
];

const thirdPartySubjects =
  /\b(?:my\s+)?(?:friend|brother|sister|mom|mother|dad|father|parent|partner|spouse|husband|wife|coworker|colleague|roommate|classmate|child|son|daughter|relative|cousin|aunt|uncle|grandparent|someone i know)\b/i;

const thirdPartyLossPatterns = [
  /\bcommitted suicide\b/i,
  /\bdied by suicide\b/i,
  /\btook (?:his|her|their) own life\b/i,
  /\bkilled (?:himself|herself|themself|themselves)\b/i,
  /\blost (?:him|her|them) to suicide\b/i,
];

const thirdPartyRiskPatterns = [
  /\b(?:is|feels?|seems?|became) suicidal\b/i,
  /\b(?:wants?|plans?|threatens?|tried|trying) to (?:die|kill (?:himself|herself|themself|themselves)|end (?:his|her|their) life)\b/i,
  /\b(?:harm|hurt)(?:ing)? (?:himself|herself|themself|themselves)\b/i,
];

const urgentMedicalPatterns = [
  /\bchest pain\b/i,
  /\btrouble breathing\b/i,
  /\bcan'?t breathe\b/i,
  /\bshortness of breath\b/i,
  /\bracing heart\b/i,
  /\bcan'?t keep (?:fluids|water) down\b/i,
  /\bunable to keep (?:fluids|water) down\b/i,
];

const doseChangePatterns = [
  /\btake more\b/i,
  /\btake less\b/i,
  /\bincrease (?:my |the )?dose\b/i,
  /\bdecrease (?:my |the )?dose\b/i,
  /\bchange (?:my |the )?dose\b/i,
  /\brestart\b/i,
  /\bstart back\b/i,
  /\bskip (?:a |my )?dose\b/i,
  /\bsplit (?:my |the )?dose\b/i,
  /\bleftover (?:medication|troches?)\b/i,
  /\bdouble (?:my |the )?dose\b/i,
  /\btake (?:two|2) troches?\b/i,
  /\bgo up (?:on|from) (?:my |the )?dose\b/i,
];

function normalize(message: string): string {
  return message.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

export function checkSafetyOverride(message: string): SafetyOverrideResult {
  const normalized = normalize(message);

  if (matchesAny(normalized, selfRiskPatterns)) {
    return { override: true, flagForReview: true, reason: "self_harm_risk" };
  }

  if (thirdPartySubjects.test(normalized)) {
    if (matchesAny(normalized, thirdPartyLossPatterns)) {
      return { override: false, flagForReview: true, reason: "third_party_suicide_loss" };
    }
    if (matchesAny(normalized, thirdPartyRiskPatterns)) {
      return { override: false, flagForReview: true, reason: "third_party_suicide_risk" };
    }
  }

  return { override: false, flagForReview: false };
}

export function isCrisisMessage(message: string): boolean {
  return checkSafetyOverride(message).override;
}

export function isUrgentMedicalMessage(message: string): boolean {
  return matchesAny(normalize(message), urgentMedicalPatterns);
}

export function isDoseChangeRequest(message: string): boolean {
  return matchesAny(normalize(message), doseChangePatterns);
}
