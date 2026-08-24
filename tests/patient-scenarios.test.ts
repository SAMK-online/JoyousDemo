import { beforeAll, describe, expect, it } from "vitest";

import { answerPatientQuestion } from "@/lib/assistant/answerPatientQuestion";
import { generatePatientAnswer } from "@/lib/assistant/openaiResponseGenerator";
import { checkSafetyOverride } from "@/lib/assistant/guardrails";
import { selectRelevantMemory } from "@/lib/assistant/conversationMemory";
import { selectRelevantClinicalContext } from "@/lib/assistant/clinicalContext";
import { buildTier3ProductInsights } from "@/lib/insights/tier3ProductInsights";
import {
  buildProductInsightsSystemPrompt,
  generateProductInsightAnswer,
} from "@/lib/insights/productInsightsAssistant";
import { JsonPatientRepository } from "@/lib/data/jsonPatientRepository";
import { normalizePatientRecord } from "@/lib/domain/normalizePatient";
import { PATIENT_IDS, type PatientId, type Tier1PatientContext } from "@/lib/domain/types";
import type { VisitNotesFile } from "@/lib/domain/types";

const repository = new JsonPatientRepository();
const contexts = new Map<PatientId, Tier1PatientContext>();
const memoryContexts = new Map<PatientId, Tier1PatientContext>();
const clinicalContexts = new Map<PatientId, Tier1PatientContext>();
const clinicalFiles = new Map<PatientId, VisitNotesFile>();

beforeAll(async () => {
  await Promise.all(
    PATIENT_IDS.map(async (uid) => {
      const [record, memory, clinical] = await Promise.all([
        repository.getPatientRecord(uid),
        repository.getPatientMemory(uid),
        repository.getPatientClinicalNotes(uid),
      ]);
      contexts.set(uid, normalizePatientRecord(record));
      memoryContexts.set(uid, normalizePatientRecord(record, memory));
      clinicalContexts.set(uid, normalizePatientRecord(record, memory, clinical));
      clinicalFiles.set(uid, clinical);
    }),
  );
});

function ask(uid: PatientId, message: string) {
  const context = contexts.get(uid);
  if (!context) throw new Error(`Missing test context for ${uid}`);
  return answerPatientQuestion(context, message);
}

function askWithMemory(uid: PatientId, message: string) {
  const context = memoryContexts.get(uid);
  if (!context) throw new Error(`Missing Tier 2 test context for ${uid}`);
  return answerPatientQuestion(context, message);
}

function askWithClinicalContext(uid: PatientId, message: string) {
  const context = clinicalContexts.get(uid);
  if (!context) throw new Error(`Missing Tier 3 test context for ${uid}`);
  return answerPatientQuestion(context, message);
}

describe("Tier 1 patient acceptance scenarios", () => {
  it("loads and isolates all five Tier 1 patient records", () => {
    expect(contexts.size).toBe(5);
    for (const uid of PATIENT_IDS) {
      expect(contexts.get(uid)?.patient.uid).toBe(uid);
      expect(contexts.get(uid)?.asOfDate).toBe("2026-08-19");
      expect(contexts.get(uid)?.knowledgeBase).toHaveLength(6);
    }
  });

  it("explains Maya's shipment exception and exhausted refills", () => {
    const result = ask("P1042", "Where is my refill, and am I going to run out?");

    expect(result.category).toBe("shipment");
    expect(result.answer).toMatch(/held at facility/i);
    expect(result.answer).toMatch(/no refills remain/i);
    expect(result.answer).not.toMatch(/replacement (?:is|has been)/i);
    expect(result.handoff?.team).toBe("Care Team");
    expect(result.sources).toContain("shipments.json");
  });

  it("does not invent a prescription or shipment for Devon", () => {
    const result = ask("P1108", "When will my medication ship?");

    expect(result.category).toBe("shipment");
    expect(result.answer).toMatch(/no medication order/i);
    expect(result.answer).toMatch(/no prescription/i);
    expect(result.answer).toMatch(/denied|not approved/i);
    expect(result.answer).not.toMatch(/3.?6 business days/i);
  });

  it("answers Devon's approval question before unrelated open tasks", () => {
    const result = ask("P1108", "Am I approved?");

    expect(result.answer).toMatch(/not approved/i);
    expect(result.answer).toMatch(/latest visit is marked Denied/i);
    expect(result.answer).not.toMatch(/main open item/i);
  });

  it("surfaces Ruth's onboarding and billing conflict", () => {
    const result = ask("P1203", "Why haven’t I received anything when I was charged?");

    expect(result.category).toBe("billing");
    expect(result.answer).toContain("$129.00");
    expect(result.answer).toMatch(/conflict/i);
    expect(result.answer).toMatch(/Care Team/i);
    expect(result.handoff?.required).toBe(true);
  });

  it("blocks Alex's dose increase and prioritizes the open safety state", () => {
    const result = ask("P1266", "This isn’t working. Can I take more?");

    expect(result.category).toBe("dose");
    expect(result.answer).toMatch(/prescription is currently on hold/i);
    expect(result.answer).toMatch(/do not increase/i);
    expect(result.handoff?.team).toBe("Nurse Team");
    expect(result.tone).toBe("urgent");
  });

  it("treats Tom's old dose as historical and does not authorize restarting", () => {
    const result = ask("P1319", "Can I restart at my old 60 mg dose?");

    expect(result.category).toBe("dose");
    expect(result.answer).toMatch(/historical/i);
    expect(result.answer).toMatch(/do not restart/i);
    expect(result.answer).toMatch(/August 24/i);
    expect(result.handoff?.team).toBe("Provider");
  });

  it("prioritizes Alex's safety case over side-effect tasks", () => {
    const result = ask("P1266", "What do I need to do next?");

    expect(result.answer).toMatch(/most important open item is: moderate safety follow-up/i);
    expect(result.tone).toBe("urgent");
    expect(result.handoff?.team).toBe("Nurse Team");
  });
});

describe("Tier 1 deterministic safety rules", () => {
  it("routes self-harm language to crisis support", () => {
    const result = ask("P1266", "I don’t want to live and I cannot stay safe");

    expect(result.category).toBe("crisis");
    expect(result.tone).toBe("urgent");
    expect(result.answer).toContain("911");
    expect(result.answer).toContain("988");
    expect(result.answer).toContain("741741");
    expect(result.handoff?.team).toBe("Nurse Team");
  });

  it("recognizes indirect self-harm wording", () => {
    const result = ask("P1266", "I have been thinking about harming myself");

    expect(result.category).toBe("crisis");
    expect(result.answer).toContain("988");
  });

  it("does not treat a third-party suicide loss as the patient's own crisis", () => {
    const message = "My friend committed suicide and I'm depressed";
    const safety = checkSafetyOverride(message);
    const result = ask("P1042", message);

    expect(safety).toEqual({
      override: false,
      flagForReview: true,
      reason: "third_party_suicide_loss",
    });
    expect(result.category).toBe("third_party_safety");
    expect(result.answer).toMatch(/sorry|painful/i);
    expect(result.answer).not.toMatch(/call 911 now/i);
    expect(result.handoff).toBeUndefined();
    expect(result.review?.reason).toBe("third_party_suicide_loss");
  });

  it("keeps self-risk as the override when third-party loss and self-risk coexist", () => {
    const message = "My friend died by suicide and now I want to die";
    const safety = checkSafetyOverride(message);
    const result = ask("P1042", message);

    expect(safety.override).toBe(true);
    expect(safety.reason).toBe("self_harm_risk");
    expect(result.category).toBe("crisis");
    expect(result.answer).toContain("988");
  });

  it("flags a current third-party suicide concern without labeling the patient suicidal", () => {
    const message = "My brother says he wants to kill himself";
    const safety = checkSafetyOverride(message);
    const result = ask("P1042", message);

    expect(safety.reason).toBe("third_party_suicide_risk");
    expect(result.category).toBe("third_party_safety");
    expect(result.answer).toMatch(/someone else/i);
    expect(result.answer).not.toMatch(/you are suicidal/i);
  });

  it("does not describe intake-only scores as a treatment trend", () => {
    const result = ask("P1203", "How is my progress looking?");

    expect(result.answer).toMatch(/only contains intake scores/i);
    expect(result.answer).toMatch(/cannot describe a treatment trend/i);
  });

  it("routes urgent physical symptoms to urgent medical care", () => {
    const result = ask("P1042", "I have chest pain and trouble breathing");

    expect(result.category).toBe("urgent_medical");
    expect(result.answer).toMatch(/urgent medical care/i);
    expect(result.answer).toContain("911");
  });

  it("reports a stable active dose without recommending a change", () => {
    const result = ask("P1042", "What dose am I taking?");

    expect(result.category).toBe("dose");
    expect(result.answer).toContain("45 mg");
    expect(result.answer).toContain("60 mg troche");
    expect(result.handoff).toBeUndefined();
  });

  it("does not claim a handoff was transmitted", () => {
    const results = [
      ask("P1042", "My shipment is stuck"),
      ask("P1203", "What form is missing?"),
      ask("P1266", "Can I increase my dose?"),
    ];

    for (const result of results) {
      expect(result.handoff?.sent).toBe(false);
      expect(result.answer).not.toMatch(/I(?:'ve| have) (?:sent|contacted|notified|messaged)/i);
    }
  });

  it("rejects arbitrary patient paths", async () => {
    await expect(repository.getPatientRecord("../P1042")).rejects.toThrow();
    await expect(repository.getPatientRecord("P9999")).rejects.toThrow();
  });
});

describe("Tier 2 conversation memory", () => {
  it("loads and isolates conversation threads for all five patients", () => {
    expect(memoryContexts.get("P1042")?.memory?.threads).toHaveLength(4);
    expect(memoryContexts.get("P1108")?.memory?.threads).toHaveLength(1);
    expect(memoryContexts.get("P1203")?.memory?.threads).toHaveLength(3);
    expect(memoryContexts.get("P1266")?.memory?.threads).toHaveLength(3);
    expect(memoryContexts.get("P1319")?.memory?.threads).toHaveLength(2);

    for (const uid of PATIENT_IDS) {
      const threadIds = memoryContexts.get(uid)?.memory?.threads.map((thread) => thread.thread_id) ?? [];
      expect(threadIds.every((threadId) => threadId.includes(uid.slice(1)))).toBe(true);
    }
  });

  it("remembers Maya's unresolved shipment thread", () => {
    const result = askWithMemory("P1042", "Any news about my refill shipment?");

    expect(result.answer).toMatch(/conversation.*still marked open/i);
    expect(result.answer).toMatch(/Care Team/i);
    expect(result.sources).toContain("tier2_memory/conversations.json#t_1042_c");
  });

  it("surfaces Devon's unanswered approval follow-up", () => {
    const result = askWithMemory("P1108", "Did anyone reply to my message about approval?");

    expect(result.answer).toMatch(/still marked open/i);
    expect(result.answer).toMatch(/no later Care Team or Nurse Team reply/i);
    expect(result.sources).toContain("tier2_memory/conversations.json#t_1108_a");
  });

  it("does not repeat Ruth's previously flagged shipping assumption", () => {
    const result = askWithMemory(
      "P1203",
      "You previously told me my medication would arrive. Is that true?",
    );

    expect(result.answer).toMatch(/no active treatment protocol|no prescription/i);
    expect(result.answer).toMatch(/earlier assistant answer.*flagged as unreliable/i);
    expect(result.sources).toContain("tier2_memory/conversations.json#t_1203_a");
  });

  it("uses a patient-safe summary for Alex's internal outreach activity", () => {
    const context = memoryContexts.get("P1266")!;
    const selected = selectRelevantMemory(context.memory, "Did anyone get my message?", "overview");
    const serialized = JSON.stringify(selected);

    expect(selected.threads[0]?.threadId).toBe("t_1266_c");
    expect(selected.threads).toHaveLength(1);
    expect(serialized).toMatch(/outbound call attempt and voicemail are recorded/i);
    expect(serialized).not.toContain("[internal]");
  });

  it("does not retrieve weakly related memory for a direct dose fact", () => {
    const context = memoryContexts.get("P1042")!;
    const selected = selectRelevantMemory(
      context.memory,
      "What dose am I taking, and what troche strength is recorded?",
      "dose",
    );

    expect(selected.threads).toHaveLength(0);
  });

  it("does not describe a resolved acknowledgment as awaiting a staff reply", () => {
    const result = askWithMemory(
      "P1042",
      "I previously said treatment was starting to feel flatter—do you remember that?",
    );

    expect(result.answer).toMatch(/May 19|previous conversation/i);
    expect(result.answer).not.toMatch(/no later Care Team or Nurse Team reply/i);
  });

  it("remembers Tom's unresolved request but does not authorize his old dose", () => {
    const result = askWithMemory("P1319", "Any word on whether I can restart at 60 mg?");

    expect(result.answer).toMatch(/historical/i);
    expect(result.answer).toMatch(/do not restart/i);
    expect(result.answer).toMatch(/conversation.*still marked open/i);
    expect(result.sources).toContain("tier2_memory/conversations.json#t_1319_b");
  });

  it("provides only relevant Tier 2 memory to the model prompt", async () => {
    const context = memoryContexts.get("P1042")!;
    const message = "Any news about my refill shipment?";
    const baseline = answerPatientQuestion(context, message);
    const generated = await generatePatientAnswer(context, message, [], baseline, {
      apiKey: "test-key",
      model: "test-model",
      generate: async ({ systemPrompt }) => {
        expect(systemPrompt).toContain("t_1042_c");
        expect(systemPrompt).not.toContain("t_1042_outbound");
        expect(systemPrompt).not.toContain("t_1203_b");
        expect(systemPrompt).toContain("Tier 1 structured records are the source of current truth");
        return baseline.answer;
      },
    });

    expect(generated.generation.mode).toBe("openai");
    expect(generated.generation.memoryThreadsUsed).toBe(2);
  });
});

describe("Tier 3 filtered clinical context", () => {
  it("loads and isolates clinical visits for all five patients", () => {
    expect(clinicalContexts.get("P1042")?.clinical?.visits).toHaveLength(2);
    expect(clinicalContexts.get("P1108")?.clinical?.visits).toHaveLength(1);
    expect(clinicalContexts.get("P1203")?.clinical?.visits).toHaveLength(1);
    expect(clinicalContexts.get("P1266")?.clinical?.visits).toHaveLength(1);
    expect(clinicalContexts.get("P1319")?.clinical?.visits).toHaveLength(2);

    for (const uid of PATIENT_IDS) {
      const noteIds = clinicalContexts.get(uid)?.clinical?.visits.map((visit) => visit.noteId) ?? [];
      expect(noteIds.every((noteId) => noteId.includes(uid.slice(1)))).toBe(true);
    }
  });

  it("removes raw summaries and internal clinician characterizations", () => {
    const serialized = JSON.stringify(
      [...clinicalContexts.values()].map((context) => context.clinical),
    );

    expect(serialized).not.toMatch(/clinical_summary|transcript/i);
    expect(serialized).not.toMatch(/self-report as a floor|unreliable at booking/i);
    expect(serialized).not.toMatch(/do not relitigate|low technical confidence|retention risk/i);
    expect(serialized).not.toMatch(/Tara's notes|everything with Sipho/i);
  });

  it("explains Maya's documented titration without creating a new instruction", () => {
    const result = askWithClinicalContext("P1042", "Why did my provider move me to 45 mg?");

    expect(result.answer).toMatch(/filtered clinical record.*April 6, 2026/i);
    expect(result.answer).toMatch(/titration to 45mg/i);
    expect(result.answer).toMatch(/not a new diagnosis or medication instruction/i);
    expect(result.sources).toContain("tier3_clinical/visit_notes.json#vn_1042_fu1");
  });

  it("explains Devon's recorded denial reason without diagnosing him", () => {
    const result = askWithClinicalContext("P1108", "Why did the provider deny treatment?");

    expect(result.category).toBe("next_step");
    expect(result.answer).toMatch(/two reasons/i);
    expect(result.answer).toMatch(/scores are low|amount you're drinking|pancreatitis/i);
    expect(result.answer).not.toMatch(/alcohol use disorder|diagnosed/i);
    expect(result.sources).toContain("tier3_clinical/visit_notes.json#vn_1108_nm");
  });

  it("explains Ruth's provider approval hold as identity verification", () => {
    const result = askWithClinicalContext("P1203", "Why can't the provider prescribe yet?");

    expect(result.answer).toMatch(/government photo ID|identification/i);
    expect(result.answer).toMatch(/not a new diagnosis or medication instruction/i);
    expect(result.sources).toContain("tier3_clinical/visit_notes.json#vn_1203_nm");
  });

  it("keeps Alex's dose increase guarded while adding the monitoring plan", () => {
    const context = clinicalContexts.get("P1266")!;
    const message = "Why shouldn't I increase my dose?";
    const baseline = answerPatientQuestion(context, message);
    let modelCalled = false;

    expect(baseline.answer).toMatch(/close monitoring|rather than increasing dose/i);

    return generatePatientAnswer(context, message, [], baseline, {
      apiKey: "test-key",
      generate: async () => {
        modelCalled = true;
        return "unsafe";
      },
    }).then((generated) => {
      expect(modelCalled).toBe(false);
      expect(generated.generation.mode).toBe("guarded");
      expect(generated.generation.clinicalNotesUsed).toBe(1);
    });
  });

  it("keeps Tom's restart plan historical and provider-controlled", () => {
    const result = askWithClinicalContext("P1319", "Why can't I restart at 60 mg?");

    expect(result.answer).toMatch(/historical/i);
    expect(result.answer).toMatch(/restart titration from quarter dose/i);
    expect(result.answer).toMatch(/provider must give you a current plan/i);
    expect(result.sources).toContain("tier3_clinical/visit_notes.json#vn_1319_fu1");
    expect(result.sources).not.toContain("tier3_clinical/visit_notes.json#vn_1319_nm");
  });

  it("sends only filtered clinical evidence to the model", async () => {
    const context = clinicalContexts.get("P1108")!;
    const message = "Why did the provider deny treatment?";
    const baseline = answerPatientQuestion(context, message);
    const selected = selectRelevantClinicalContext(context.clinical, message, baseline.category);

    expect(selected.visits).toHaveLength(1);
    expect(JSON.stringify(selected)).not.toMatch(/note to file|clinical_summary|transcript/i);

    const generated = await generatePatientAnswer(context, message, [], baseline, {
      apiKey: "test-key",
      model: "test-model",
      generate: async ({ systemPrompt }) => {
        expect(systemPrompt).toContain("vn_1108_nm");
        expect(systemPrompt).not.toContain("clear minimisation");
        expect(systemPrompt).not.toContain("do not relitigate");
        return baseline.answer;
      },
    });

    expect(generated.generation.mode).toBe("openai");
    expect(generated.generation.clinicalNotesUsed).toBe(1);
  });

  it("uses clinical context only for explicit clinical-reasoning questions", () => {
    const context = clinicalContexts.get("P1042")!;
    const summary = selectRelevantClinicalContext(
      context.clinical,
      "Can you summarize my current treatment status?",
      "next_step",
    );
    const doseFact = selectRelevantClinicalContext(
      context.clinical,
      "What dose am I taking?",
      "dose",
    );
    const rationale = selectRelevantClinicalContext(
      context.clinical,
      "Why did my provider move me to 45 mg?",
      "dose",
    );
    const operationalVisit = selectRelevantClinicalContext(
      context.clinical,
      "Do I need another visit?",
      "appointment",
    );

    expect(summary.visits).toHaveLength(0);
    expect(doseFact.visits).toHaveLength(0);
    expect(operationalVisit.visits).toHaveLength(0);
    expect(rationale.visits).toHaveLength(1);
    expect(rationale.visits[0]?.noteId).toBe("vn_1042_fu1");
  });

  it("answers visit eligibility from Tier 1 while exposing any Tier 2 source used by Luna", async () => {
    const context = clinicalContexts.get("P1042")!;
    const message = "Do I need another visit?";
    const baseline = answerPatientQuestion(context, message);

    expect(baseline.sources.some((source) => source.startsWith("tier3_clinical"))).toBe(false);
    expect(baseline.facts.some((fact) => fact.label === "Clinical context")).toBe(false);

    const generated = await generatePatientAnswer(context, message, [], baseline, {
      apiKey: "test-key",
      model: "test-model",
      generate: async () => baseline.answer,
    });

    expect(generated.generation.clinicalNotesUsed).toBe(0);
    expect(generated.result.sources).not.toContain(
      "tier3_clinical/visit_notes.json#vn_1042_fu1",
    );
    expect(generated.generation.memoryThreadsUsed).toBe(1);
    expect(generated.result.sources).toContain(
      "tier2_memory/conversations.json#t_1042_outbound",
    );
  });

  it("rejects model output containing internal clinical characterizations", async () => {
    const context = clinicalContexts.get("P1042")!;
    const message = "Why did my provider move me to 45 mg?";
    const baseline = answerPatientQuestion(context, message);
    const generated = await generatePatientAnswer(context, message, [], baseline, {
      apiKey: "test-key",
      model: "test-model",
      generate: async () => "Your chart says you under-report severity and are unreliable at booking.",
    });

    expect(generated.generation.mode).toBe("fallback");
    expect(generated.result.answer).toBe(baseline.answer);
    expect(generated.result.answer).not.toMatch(/under-report|unreliable at booking/i);
  });
});

describe("Tier 3 offline product-learning stream", () => {
  it("aggregates all visits without exposing patient identities or verbatim examples", () => {
    const report = buildTier3ProductInsights([...clinicalFiles.values()]);
    const serialized = JSON.stringify(report);

    expect(report.totalPatients).toBe(5);
    expect(report.totalVisits).toBe(7);
    expect(report.explicitQuestionCount).toBe(4);
    expect(report.themes.length).toBeGreaterThanOrEqual(7);
    expect(serialized).not.toMatch(/P1042|P1108|P1203|P1266|P1319/);
    expect(serialized).not.toMatch(/Maya|Devon|Ruth|Alex|Tom/);
    expect(serialized).not.toContain("It's not dramatic, it's just grey.");
  });

  it("identifies Tier 1 gaps and produces reviewable product opportunities", () => {
    const report = buildTier3ProductInsights([...clinicalFiles.values()]);
    const eligibility = report.themes.find((theme) => theme.id === "eligibility_decisions");
    const affordability = report.themes.find((theme) => theme.id === "affordability");
    const medicalEligibility = report.themes.find((theme) => theme.id === "medical_eligibility");

    expect(eligibility?.coverage).toBe("partial");
    expect(eligibility?.patientCount).toBe(1);
    expect(affordability?.coverage).toBe("gap");
    expect(medicalEligibility?.coverage).toBe("gap");
    expect(report.coverageSummary.gap).toBeGreaterThan(0);
    expect(report.themes.every((theme) => theme.opportunity.length > 20)).toBe(true);
  });

  it("keeps the analysis deterministic and explicitly separate from live responses", () => {
    const files = [...clinicalFiles.values()];
    const first = buildTier3ProductInsights(files);
    const second = buildTier3ProductInsights(files);

    expect(second).toEqual(first);
    expect(first.methodology.join(" ")).toMatch(/separately from the patient chat/i);
    expect(first.methodology.join(" ")).toMatch(/no transcript text is sent to OpenAI/i);
    expect(first.methodology.join(" ")).toMatch(/Clinical review/i);
  });

  it("gives the product copilot only the de-identified aggregate report", () => {
    const report = buildTier3ProductInsights([...clinicalFiles.values()]);
    const prompt = buildProductInsightsSystemPrompt(report);

    expect(prompt).toContain("AGGREGATED_PRODUCT_INSIGHTS");
    expect(prompt).toContain('"patients":5');
    expect(prompt).toContain('"id":"affordability"');
    expect(prompt).not.toMatch(/P1042|P1108|P1203|P1266|P1319/);
    expect(prompt).not.toMatch(/Maya|Devon|Ruth|Alex|Tom/);
    expect(prompt).not.toContain("It's not dramatic, it's just grey.");
  });

  it("attaches verified theme counts to model evidence", async () => {
    const report = buildTier3ProductInsights([...clinicalFiles.values()]);
    const affordability = report.themes.find((theme) => theme.id === "affordability")!;
    const result = await generateProductInsightAnswer(
      report,
      "Which gap should we investigate?",
      [],
      {
        apiKey: "test-key",
        model: "test-model",
        generate: async ({ systemPrompt }) => {
          expect(systemPrompt).not.toMatch(/P1042|Maya/);
          return {
            answer: "Affordability is a useful discovery signal, not a validated prevalence estimate.",
            evidence: [{ themeId: "affordability", claim: "Cost pressure appears in this sample." }],
            suggestedActions: ["Interview patients about when cost becomes a continuation barrier."],
            limitation: "The sample is small and synthetic.",
          };
        },
      },
    );

    expect(result.generation.mode).toBe("openai");
    expect(result.evidence[0]).toMatchObject({
      themeId: "affordability",
      themeTitle: affordability.title,
      patientCount: affordability.patientCount,
      mentionCount: affordability.mentionCount,
      coverage: "gap",
    });
  });

  it("rejects invented model citations and falls back to verified aggregates", async () => {
    const report = buildTier3ProductInsights([...clinicalFiles.values()]);
    const result = await generateProductInsightAnswer(report, "What is missing?", [], {
      apiKey: "test-key",
      model: "test-model",
      generate: async () => ({
        answer: "A hidden pattern exists.",
        evidence: [{ themeId: "invented_theme", claim: "Unsupported claim." }],
        suggestedActions: [],
        limitation: "None.",
      }),
    });

    expect(result.generation.mode).toBe("fallback");
    expect(result.evidence.every((item) => report.themes.some((theme) => theme.id === item.themeId))).toBe(true);
    expect(result.limitation).toMatch(/synthetic/i);
  });

  it("still answers from aggregates when OpenAI is not configured", async () => {
    const report = buildTier3ProductInsights([...clinicalFiles.values()]);
    const result = await generateProductInsightAnswer(
      report,
      "What should we investigate about affordability?",
      [],
      { apiKey: "" },
    );

    expect(result.generation.mode).toBe("fallback");
    expect(result.evidence[0]?.themeId).toBe("affordability");
    expect(result.answer).toMatch(/discovery lead/i);
  });
});

describe("OpenAI grounded generation layer", () => {
  it("uses the deterministic fallback when no API key is configured", async () => {
    const context = contexts.get("P1042")!;
    const baseline = answerPatientQuestion(context, "How are my scores trending?");
    const generated = await generatePatientAnswer(context, "How are my scores trending?", [], baseline, {
      apiKey: "",
    });

    expect(generated.generation.mode).toBe("fallback");
    expect(generated.result).toEqual(baseline);
  });

  it("uses OpenAI output for an ordinary grounded question", async () => {
    const context = contexts.get("P1042")!;
    const baseline = answerPatientQuestion(context, "How are my scores trending?");
    const generated = await generatePatientAnswer(context, "How are my scores trending?", [], baseline, {
      apiKey: "test-key",
      model: "test-model",
      generate: async ({ systemPrompt }) => {
        expect(systemPrompt).toContain("GROUNDED_PATIENT_CONTEXT");
        expect(systemPrompt).toContain('"uid":"P1042"');
        expect(systemPrompt).not.toContain('"uid":"P1266"');
        return "Your recorded PHQ and GAD scores have both moved lower overall.";
      },
    });

    expect(generated.generation.mode).toBe("openai");
    expect(generated.generation.model).toBe("test-model");
    expect(generated.result.answer).toMatch(/moved lower/i);
    expect(generated.result.facts).toEqual(baseline.facts);
  });

  it("lets OpenAI respond empathetically to third-party loss with review context", async () => {
    const context = contexts.get("P1042")!;
    const message = "My friend committed suicide and I'm depressed";
    const baseline = answerPatientQuestion(context, message);
    let modelCalled = false;
    const generated = await generatePatientAnswer(context, message, [], baseline, {
      apiKey: "test-key",
      model: "test-model",
      generate: async ({ systemPrompt }) => {
        modelCalled = true;
        expect(systemPrompt).toContain('"safetyClassification":"third_party_suicide_loss"');
        expect(systemPrompt).toContain("do not describe the patient as suicidal");
        return "I’m very sorry about your friend. That kind of loss can feel overwhelming, and I’m here to listen.";
      },
    });

    expect(modelCalled).toBe(true);
    expect(generated.generation.mode).toBe("openai");
    expect(generated.result.category).toBe("third_party_safety");
    expect(generated.result.review?.required).toBe(true);
  });

  it("rejects model output that attributes third-party suicide risk to the patient", async () => {
    const context = contexts.get("P1042")!;
    const message = "My friend committed suicide and I'm depressed";
    const baseline = answerPatientQuestion(context, message);
    const generated = await generatePatientAnswer(context, message, [], baseline, {
      apiKey: "test-key",
      model: "test-model",
      generate: async () => "You are suicidal and need to call 911 now.",
    });

    expect(generated.generation.mode).toBe("fallback");
    expect(generated.result.answer).toBe(baseline.answer);
    expect(generated.result.answer).not.toMatch(/you are suicidal/i);
  });

  it("never sends a dose-change request to the model", async () => {
    const context = contexts.get("P1266")!;
    const baseline = answerPatientQuestion(context, "Can I take more?");
    let modelCalled = false;
    const generated = await generatePatientAnswer(context, "Can I take more?", [], baseline, {
      apiKey: "test-key",
      generate: async () => {
        modelCalled = true;
        return "unsafe";
      },
    });

    expect(modelCalled).toBe(false);
    expect(generated.generation.mode).toBe("guarded");
    expect(generated.result).toEqual(baseline);
  });

  it("rejects a model response that falsely claims a human action", async () => {
    const context = contexts.get("P1203")!;
    const baseline = answerPatientQuestion(context, "Why was I charged?");
    const generated = await generatePatientAnswer(context, "Why was I charged?", [], baseline, {
      apiKey: "test-key",
      generate: async () => "I've contacted the Care Team and sent your refund request.",
    });

    expect(generated.generation.mode).toBe("fallback");
    expect(generated.result.answer).toBe(baseline.answer);
  });
});
