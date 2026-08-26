import type { VisitNotesFile } from "../domain/types.js";

export type InsightCoverage = "covered" | "partial" | "gap";
export type InsightPriority = "high" | "medium" | "low";

interface ThemeDefinition {
  id: string;
  title: string;
  description: string;
  pattern: RegExp;
  coverage: InsightCoverage;
  priority: InsightPriority;
  currentCapability: string;
  opportunity: string;
  example: string;
}

export interface ProductInsightTheme extends Omit<ThemeDefinition, "pattern"> {
  patientCount: number;
  mentionCount: number;
  explicitQuestionCount: number;
}

export interface Tier3ProductInsightsReport {
  asOfDate: string;
  totalPatients: number;
  totalVisits: number;
  patientUtteranceCount: number;
  explicitQuestionCount: number;
  matchedNeedCount: number;
  coverageSummary: Record<InsightCoverage, number>;
  themes: ProductInsightTheme[];
  methodology: string[];
}

const themeDefinitions: ThemeDefinition[] = [
  {
    id: "outcomes_expectations",
    title: "When treatment should feel effective",
    description: "Patients ask how long improvement takes and whether subtle changes mean treatment is working.",
    pattern: /\b(?:work(?:ing)?|help(?:ing)?|feel better|how long|flat|grey|improv|suits me)\b/i,
    coverage: "partial",
    priority: "high",
    currentCapability: "Tier 1 reports score trends and check-in history without interpreting clinical effectiveness.",
    opportunity: "Add an approved expectations article and clearer language separating observed trends from clinical conclusions.",
    example: "How long should it take before I notice whether treatment is helping?",
  },
  {
    id: "side_effects_sleep",
    title: "Side effects and sleep changes",
    description: "Patients discuss nausea, sleep disruption, appetite, and early-treatment discomfort.",
    pattern: /\b(?:nausea|queasy|side effect|sleep(?:ing)?|appetite|bumpy)\b/i,
    coverage: "covered",
    priority: "medium",
    currentCapability: "Tier 1 explains common effects, reports recorded symptoms, and routes persistent or urgent symptoms.",
    opportunity: "Expand approved symptom-specific guidance while retaining urgent-medical and dose-change overrides.",
    example: "Is this symptom expected, and when should I ask the Nurse Team about it?",
  },
  {
    id: "eligibility_decisions",
    title: "Why treatment was approved or declined",
    description: "Patients want understandable reasons when a provider decides treatment is not appropriate or places it on hold.",
    pattern: /\b(?:why not|right treatment|appropriate|approv|declin|deni|so that'?s it)\b/i,
    coverage: "partial",
    priority: "high",
    currentCapability: "Tier 1 reports approval status but often lacks the provider's documented reasoning.",
    opportunity: "Create clinically reviewed explanation templates that state the decision, summarize allowed reasons, and offer the correct follow-up channel.",
    example: "Why wasn’t I approved, and what am I supposed to do next?",
  },
  {
    id: "renewal_continuity",
    title: "Renewals and what happens next",
    description: "Patients ask what happens after the initial supply and who is responsible for booking renewal visits.",
    pattern: /\b(?:and then what|refill|renew|book(?:ing)?|shipment|supply|what happens next)\b/i,
    coverage: "covered",
    priority: "low",
    currentCapability: "Tier 1 combines appointments, refill counts, shipment state, and approved renewal guidance.",
    opportunity: "Add proactive reminders when refills are exhausted and no renewal visit is scheduled.",
    example: "What happens after this supply, and do I need to book another visit?",
  },
  {
    id: "onboarding_access",
    title: "Identity and onboarding help",
    description: "Patients can understand the requirement but still struggle to complete digital identity or onboarding tasks.",
    pattern: /\b(?:account|identification|government id|photo id|daughter.*help|computer|online things|upload)\b/i,
    coverage: "partial",
    priority: "medium",
    currentCapability: "Tier 1 identifies missing forms and identity holds but cannot complete or verify the task.",
    opportunity: "Add accessible upload instructions, alternate support paths, and confirmation when documents are received.",
    example: "I understand an ID is missing, but how do I actually submit it?",
  },
  {
    id: "affordability",
    title: "Affordability and stopping treatment",
    description: "Cost pressure can cause patients to consider cancelling or stopping before discussing available support.",
    pattern: /\b(?:money|cost|afford|tight|charg(?:e|ed|ing)|cancel)\b/i,
    coverage: "gap",
    priority: "medium",
    currentCapability: "Tier 1 explains billing records and policy but has no approved affordability or retention guidance.",
    opportunity: "Define approved language and a Care Team pathway for affordability questions before cancellation.",
    example: "What options do I have if treatment is helping but I can’t afford to continue?",
  },
  {
    id: "safety_disclosure",
    title: "Safety disclosure and immediate support",
    description: "Visit conversations include direct and indirect discussion of self-harm thoughts and current safety.",
    pattern: /\b(?:hurt(?:ing)? myself|self[- ]?harm|not actively|wouldn'?t do anything|disappear|never that)\b/i,
    coverage: "covered",
    priority: "high",
    currentCapability: "Tier 1 uses deterministic subject-aware crisis routing and separates third-party loss from personal risk.",
    opportunity: "Continuously expand phrasing tests and monitor false positives and false negatives with clinical review.",
    example: "I’m not planning to act, but difficult thoughts sometimes cross my mind.",
  },
  {
    id: "medical_eligibility",
    title: "Medical history and treatment eligibility",
    description: "Patients discuss alcohol use, prior hospitalization, blood pressure, and other history that can affect provider decisions.",
    pattern: /\b(?:drinking|alcohol|pancreatitis|blood pressure|heart|hospital|inpatient|medications?)\b/i,
    coverage: "gap",
    priority: "high",
    currentCapability: "Tier 1 can display submitted information but should not interpret whether it makes treatment safe or appropriate.",
    opportunity: "Route eligibility questions to clinically approved explanations or a provider call without having the assistant infer a decision.",
    example: "Does something in my medical history affect whether this treatment is appropriate?",
  },
  {
    id: "personal_context",
    title: "Life context behind treatment questions",
    description: "Bereavement, work stress, job loss, and family experiences shape what patients need from the conversation.",
    pattern: /\b(?:husband died|job loss|laid off|work(?:'s| is)? been|kids|son|wife|burnout|after the move)\b/i,
    coverage: "gap",
    priority: "medium",
    currentCapability: "Tier 1 answers record questions but has little approved support for acknowledging major life context.",
    opportunity: "Add empathetic response patterns that acknowledge context without diagnosing or turning the assistant into therapy.",
    example: "A major life event is affecting how I’m feeling and what I need from treatment.",
  },
];

export function buildTier3ProductInsights(
  files: VisitNotesFile[],
  asOfDate = "2026-08-19",
): Tier3ProductInsightsReport {
  const utterances = files.flatMap((file) =>
    file.notes.flatMap((note) =>
      note.transcript
        .filter((line) => line.speaker === "Patient" && !/^\s*\[/.test(line.text))
        .map((line) => ({ patientKey: file.uid, text: line.text })),
    ),
  );

  const themes = themeDefinitions
    .map(({ pattern, ...definition }): ProductInsightTheme => {
      const matches = utterances.filter((utterance) => pattern.test(utterance.text));
      return {
        ...definition,
        patientCount: new Set(matches.map((match) => match.patientKey)).size,
        mentionCount: matches.length,
        explicitQuestionCount: matches.filter((match) => match.text.includes("?")).length,
      };
    })
    .filter((theme) => theme.mentionCount > 0)
    .sort((a, b) => {
      const priorityRank: Record<InsightPriority, number> = { high: 0, medium: 1, low: 2 };
      return priorityRank[a.priority] - priorityRank[b.priority] || b.patientCount - a.patientCount;
    });

  const coverageSummary: Record<InsightCoverage, number> = {
    covered: themes.filter((theme) => theme.coverage === "covered").length,
    partial: themes.filter((theme) => theme.coverage === "partial").length,
    gap: themes.filter((theme) => theme.coverage === "gap").length,
  };

  return {
    asOfDate,
    totalPatients: new Set(files.map((file) => file.uid)).size,
    totalVisits: files.reduce((count, file) => count + file.notes.length, 0),
    patientUtteranceCount: utterances.length,
    explicitQuestionCount: utterances.filter((utterance) => utterance.text.includes("?")).length,
    matchedNeedCount: themes.reduce((count, theme) => count + theme.mentionCount, 0),
    coverageSummary,
    themes,
    methodology: [
      "Runs separately from the patient chat and does not alter live responses.",
      "Analyzes only synthetic patient utterances from Tier 3 visit transcripts.",
      "Uses deterministic theme rules; no transcript text is sent to OpenAI.",
      "Displays aggregate counts and authored paraphrases rather than patient names, IDs, or verbatim utterances.",
      "Recommendations require Product and Clinical review before becoming Tier 1 content or behavior.",
    ],
  };
}
