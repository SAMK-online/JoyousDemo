import { classifyIntent } from "@/lib/assistant/classifyIntent";
import { applyConversationMemory } from "@/lib/assistant/conversationMemory";
import { applyClinicalContext } from "@/lib/assistant/clinicalContext";
import { checkSafetyOverride, isDoseChangeRequest } from "@/lib/assistant/guardrails";
import type {
  AssistantAnswer,
  Handoff,
  KnowledgeArticle,
  Meeting,
  PatientCase,
  Tier1PatientContext,
} from "@/lib/domain/types";

const trackingLabels: Record<string, string> = {
  AC: "Accepted by USPS",
  IT: "In transit",
  DE: "Delivered",
  AT: "Delivery attempted",
  EX: "Delivery exception",
  NY: "Not yet in the carrier system",
  SP: "Held for collection",
};

const timezoneLabels: Record<string, string> = {
  "America/Denver": "Mountain time",
  "America/Chicago": "Central time",
  "America/Detroit": "Eastern time",
  "America/Los_Angeles": "Pacific time",
  "America/New_York": "Eastern time",
};

const lifecycleLabels: Record<string, string> = {
  active: "active treatment",
  onboarding: "onboarding",
  not_approved: "not approved",
  churned: "past patient",
};

function source(...values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function article(context: Tier1PatientContext, id: string): KnowledgeArticle {
  const match = context.knowledgeBase.find((item) => item.article_id === id);
  if (!match) throw new Error(`Missing required knowledge article: ${id}`);
  return match;
}

function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: year === 2026 ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatMeeting(meeting: Meeting, timezone: string): string {
  const [date, time = "00:00:00"] = meeting.scheduled_at.split("T");
  const [hours, minutes] = time.split(":").map(Number);
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 1, hours, minutes)));
  return `${formatDate(date)} at ${clock} ${timezoneLabels[timezone] ?? "local time"}`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function handoff(team: Handoff["team"], reason: string): Handoff {
  return { required: true, team, reason, sent: false };
}

function describeCase(patientCase: PatientCase): string | null {
  switch (patientCase.case_type) {
    case "suicidality":
      return `${patientCase.risk ?? "Elevated"} safety follow-up is waiting on the Nurse Team`;
    case "hhh":
      return patientCase.requirement === "government_photo_id"
        ? "Government photo ID is still required to continue onboarding"
        : "An onboarding requirement is still outstanding";
    case "create_prescription":
      return "Prescription creation is waiting on the clinical team";
    case "refill":
      return patientCase.check_list?.refills_remaining === 0
        ? "No refills remain on the current prescription"
        : "A refill task is still open";
    case "medication_order":
      return "Medication delivery has not been confirmed";
    case "side_effects":
      return `${patientCase.sub_type ?? "Side-effect"} follow-up is still open`;
    case "payment":
      return "A payment case is still open";
    default:
      return null;
  }
}

function answerCrisis(context: Tier1PatientContext): AssistantAnswer {
  const crisisArticle = article(context, "kb_crisis_support");
  const recordedRisk = context.safetyCase
    ? ` Your Tier 1 record also shows an open ${context.safetyCase.risk ?? "elevated"}-risk follow-up.`
    : "";

  return {
    answer:
      `I’m glad you said something. If you are in immediate danger or may act on these thoughts, call 911 now. ` +
      `You can call or text 988 to reach the Suicide and Crisis Lifeline, or text HOME to 741741.${recordedRisk} ` +
      `Joyous is not an emergency service and messages are not monitored around the clock. This needs live Nurse Team follow-up; this demo cannot send that message for you.`,
    category: "crisis",
    tone: "urgent",
    facts: [
      { label: "Immediate danger", value: "Call 911", tone: "urgent" },
      { label: "Crisis support", value: "Call or text 988", tone: "urgent" },
      { label: "Crisis Text Line", value: "Text HOME to 741741" },
    ],
    sources: source(crisisArticle.sourceFile, context.safetyCase ? "cases.json" : undefined),
    handoff: handoff("Nurse Team", "Possible self-harm or immediate-safety concern"),
  };
}

function answerThirdPartySafety(context: Tier1PatientContext, message: string): AssistantAnswer {
  const crisisArticle = article(context, "kb_crisis_support");
  const safety = checkSafetyOverride(message);
  const isLoss = safety.reason === "third_party_suicide_loss";

  return {
    answer: isLoss
      ? "I’m so sorry you’re going through this. Losing someone to suicide can be deeply painful, and feeling depressed after a loss deserves care and support. If you’d like, you can tell me what feels hardest right now, and reaching out to someone you trust or a grief-support resource may help you feel less alone. If you are also having thoughts of hurting yourself or feel unable to stay safe, please tell me directly so I can share immediate crisis options."
      : "I’m sorry—you’re describing a serious concern about someone else. If they may act now or are in immediate danger, call 911; in the U.S., you or they can also call or text 988 for guidance. I can listen and help you think through what support is available, but I can’t assess their safety or contact anyone through this demo.",
    category: "third_party_safety",
    tone: "attention",
    facts: [],
    sources: [crisisArticle.sourceFile],
    review: {
      required: true,
      reason: isLoss ? "third_party_suicide_loss" : "third_party_suicide_risk",
      logged: true,
      sent: false,
    },
  };
}

function answerUrgentMedical(context: Tier1PatientContext): AssistantAnswer {
  const sideEffectsArticle = article(context, "kb_side_effects");
  return {
    answer:
      "The symptoms you described are listed as urgent in Joyous guidance. Seek urgent medical care now. If you are in immediate danger, call 911. Do not wait for a chat response or change your dose based on this assistant.",
    category: "urgent_medical",
    tone: "urgent",
    facts: [{ label: "Recommended action", value: "Seek urgent medical care", tone: "urgent" }],
    sources: [sideEffectsArticle.sourceFile],
    handoff: handoff("Nurse Team", "Urgent symptoms reported"),
  };
}

function answerShipment(context: Tier1PatientContext): AssistantAnswer {
  const shipmentArticle = article(context, "kb_shipments_refills");
  const latest = context.latestShipment;
  const refillCase = context.openCases.find((item) => item.case_type === "refill");

  if (!latest) {
    const latestMeeting = context.latestMeeting;
    const requirement = context.openCases.find((item) => item.case_type === "hhh");
    let reason = "There is no medication order or tracking number in your Tier 1 record.";

    if (context.patient.status === "not_approved") {
      reason += ` Your latest visit is marked ${latestMeeting?.status ?? "not approved"}, and no prescription is recorded.`;
    } else if (requirement?.requirement === "government_photo_id") {
      reason += " Your appointment is on hold while government photo ID is verified, and no prescription is recorded yet.";
    }

    return {
      answer: `${reason} I can’t give you a shipping estimate until a prescription and order exist. The Care Team needs to clarify the next step; this demo has not contacted them.`,
      category: "shipment",
      tone: "attention",
      facts: [
        { label: "Prescription", value: latestMeeting?.prescription ? "Recorded" : "Not recorded", tone: "attention" },
        { label: "Shipment", value: "No order found", tone: "attention" },
      ],
      sources: source("meetings.json", "shipments.json", requirement ? "cases.json" : undefined),
      handoff: handoff("Care Team", "No shipment exists and account status needs clarification"),
    };
  }

  const code = latest.tracking.statusCode;
  const status = trackingLabels[code] ?? code;
  const latestEvent = [...latest.tracking.events].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  )[0];
  const isException = code === "EX" || code === "AT" || code === "SP";
  const supply = context.patient.protocol?.troches;
  const supplyDate = context.patient.protocol?.datetrochecount;
  const refillsRemaining = refillCase?.check_list?.refills_remaining;

  const details = [
    `Your latest ${latest.is_refill ? "refill" : "medication order"} shipped on ${formatDate(latest.shipDate)}.`,
    latestEvent ? `The latest carrier update says “${latestEvent.description}” from ${formatDate(latestEvent.occurredAt)}.` : "",
    latest.pt_confirmed_delivery ? "Delivery is confirmed in your record." : "Delivery has not been confirmed in your record.",
    supply ? `Your record listed ${supply} troches on ${formatDate(supplyDate ?? context.asOfDate)}.` : "",
    refillsRemaining === 0 ? "It also shows that no refills remain on the current prescription." : "",
  ].filter(Boolean);

  return {
    answer:
      `${details.join(" ")} ` +
      (isException
        ? "Because the package has a delivery problem, the Care Team needs to resolve it with the carrier. This demo cannot arrange or promise a replacement."
        : code === "DE"
          ? "If you cannot find a package marked delivered, the Care Team should investigate it."
          : "Carrier estimates can change, so use the tracking status as the latest available update."),
    category: "shipment",
    tone: isException ? "attention" : code === "DE" ? "positive" : "neutral",
    facts: [
      { label: "Order", value: latest.order_number },
      { label: "Carrier status", value: status, tone: isException ? "attention" : undefined },
      {
        label: code === "DE" ? "Delivered" : "Estimated delivery",
        value: formatDate(latest.tracking.actualDeliveryDate ?? latest.tracking.estimatedDeliveryDate ?? latest.shipDate),
      },
      ...(refillsRemaining === 0
        ? [{ label: "Refills remaining", value: "0", tone: "attention" as const }]
        : []),
    ],
    sources: source("shipments.json", refillCase ? "cases.json" : undefined, shipmentArticle.sourceFile),
    handoff: isException
      ? handoff("Care Team", "Shipment has a delivery exception and delivery is unconfirmed")
      : undefined,
  };
}

function answerBilling(context: Tier1PatientContext): AssistantAnswer {
  const billingArticle = article(context, "kb_appointments_billing");
  const paymentCases = context.openCases.filter((item) => item.case_type === "payment");
  const recordedCharge = context.allCases.flatMap((item) => item.charges ?? [])[0];

  if (recordedCharge && context.patient.status !== "active") {
    return {
      answer:
        `Your Tier 1 record shows a ${formatCurrency(recordedCharge.amount_usd)} ${recordedCharge.description.toLowerCase()} charge on ${formatDate(recordedCharge.date)}, ` +
        `but your treatment status is ${lifecycleLabels[context.patient.status]}. Joyous policy says treatment is not charged until provider approval and subscription activation. ` +
        "Those records conflict, so the Care Team needs to review the account. This demo cannot issue or promise a refund.",
      category: "billing",
      tone: "attention",
      facts: [
        { label: "Recorded charge", value: formatCurrency(recordedCharge.amount_usd), tone: "attention" },
        { label: "Treatment status", value: lifecycleLabels[context.patient.status], tone: "attention" },
      ],
      sources: ["cases.json", "patient.json", billingArticle.sourceFile],
      handoff: handoff("Care Team", "Recorded charge conflicts with current treatment status"),
    };
  }

  if (paymentCases.length) {
    return {
      answer:
        "Your Tier 1 record shows an open payment case, but it does not provide enough transaction detail for me to confirm a balance or charge. Joyous policy says treatment is not charged until provider approval and subscription activation. The Care Team should verify the account; this demo cannot access payment processing.",
      category: "billing",
      tone: "attention",
      facts: [{ label: "Payment case", value: "Open", tone: "attention" }],
      sources: ["cases.json", billingArticle.sourceFile],
      handoff: handoff("Care Team", "Open payment case requires account verification"),
    };
  }

  return {
    answer: `${billingArticle.body.join(" ")} I can explain the policy, but this Tier 1 demo cannot view card transactions or change a subscription.`,
    category: "billing",
    tone: "neutral",
    facts: [{ label: "Billing access", value: "Policy only" }],
    sources: [billingArticle.sourceFile],
  };
}

function answerAppointment(context: Tier1PatientContext): AssistantAnswer {
  const appointmentArticle = article(context, "kb_appointments_billing");
  const upcoming = context.upcomingMeetings[0];

  if (upcoming) {
    return {
      answer:
        `Your next ${upcoming.type === "RP" ? "returning-patient" : "follow-up"} visit is scheduled for ${formatMeeting(upcoming, context.patient.profile.timezone)} ` +
        `with ${upcoming.provider}. Its current status is ${upcoming.status}. ` +
        (upcoming.status === "Not Confirmed"
          ? "Because it is not confirmed, check your account or contact the Care Team before the visit."
          : "You can use your account for appointment details or changes."),
      category: "appointment",
      tone: upcoming.status === "Not Confirmed" ? "attention" : "neutral",
      facts: [
        { label: "Date", value: formatMeeting(upcoming, context.patient.profile.timezone) },
        { label: "Provider", value: upcoming.provider },
        { label: "Status", value: upcoming.status, tone: upcoming.status === "Not Confirmed" ? "attention" : undefined },
      ],
      sources: ["meetings.json", appointmentArticle.sourceFile],
    };
  }

  const refillCase = context.openCases.find((item) => item.case_type === "refill");
  const renewalDue = refillCase?.check_list?.refills_remaining === 0;
  return {
    answer:
      `There is no upcoming visit in your Tier 1 record. ` +
      (renewalDue
        ? "Your refill record shows no refills remaining, so a provider visit is needed before another prescription can be written. You book follow-up visits from your account."
        : "Follow-up visits are booked from your account. The Care Team can help if you cannot access booking."),
    category: "appointment",
    tone: renewalDue ? "attention" : "neutral",
    facts: [
      { label: "Upcoming visit", value: "None found", tone: renewalDue ? "attention" : undefined },
      ...(renewalDue ? [{ label: "Refills remaining", value: "0", tone: "attention" as const }] : []),
    ],
    sources: source("meetings.json", renewalDue ? "cases.json" : undefined, appointmentArticle.sourceFile),
  };
}

function answerCheckins(context: Tier1PatientContext, message: string): AssistantAnswer {
  const checkinArticle = article(context, "kb_check_ins");
  const asksGeneral = /how|what (?:is|are)|why|frequency|often/i.test(message) &&
    !/my|score|progress|working|better|worse/i.test(message);

  if (asksGeneral) {
    return {
      answer: checkinArticle.body.join(" "),
      category: "checkin",
      tone: "neutral",
      facts: [{ label: "Typical cadence", value: "Daily first, often weekly later" }],
      sources: [checkinArticle.sourceFile],
    };
  }

  if (context.checkinCount === 0) {
    return {
      answer:
        "Your record only contains intake scores and no treatment check-in history. That usually means treatment check-ins have not started. I can explain how check-ins work, but I cannot describe a treatment trend yet.",
      category: "checkin",
      tone: "neutral",
      facts: [{ label: "Treatment check-ins", value: "Not started" }],
      sources: ["checkins.json", checkinArticle.sourceFile],
    };
  }

  const worsening = context.phqTrend.direction === "worsening" || context.gadTrend.direction === "worsening";
  const hasSafetyCase = Boolean(context.safetyCase);
  const trendSentence = [
    context.phqTrend.initial !== null
      ? `PHQ changed from ${context.phqTrend.initial} to ${context.phqTrend.latest}`
      : null,
    context.gadTrend.initial !== null
      ? `GAD changed from ${context.gadTrend.initial} to ${context.gadTrend.latest}`
      : null,
  ].filter(Boolean).join(", and ");

  return {
    answer:
      `Your current check-in cadence is ${context.patient.protocol?.checkin ?? "not set"}. ${trendSentence}. ` +
      (context.recentMood !== null ? `Your most recent mood rating is ${context.recentMood} out of 5. ` : "") +
      (worsening
        ? "The scores are moving in the wrong direction; that does not by itself prove why, but it needs clinical review rather than an automatic dose change."
        : "The scores are moving lower overall, which is an improvement on these measures, but only your care team can interpret what that means clinically."),
    category: "checkin",
    tone: worsening || hasSafetyCase ? "attention" : "positive",
    facts: [
      { label: "Cadence", value: context.patient.protocol?.checkin ?? "Not set" },
      { label: "PHQ", value: `${context.phqTrend.initial ?? "—"} → ${context.phqTrend.latest ?? "—"}` },
      { label: "GAD", value: `${context.gadTrend.initial ?? "—"} → ${context.gadTrend.latest ?? "—"}` },
      ...(context.recentMood !== null
        ? [{ label: "Latest mood", value: `${context.recentMood}/5`, tone: context.recentMood <= 2 ? "attention" as const : undefined }]
        : []),
    ],
    sources: ["checkins.json", "patient.json", checkinArticle.sourceFile],
    handoff: worsening || hasSafetyCase
      ? handoff("Nurse Team", "Symptoms are worsening or a safety follow-up is open")
      : undefined,
  };
}

function answerSideEffects(context: Tier1PatientContext, message: string): AssistantAnswer {
  const sideEffectsArticle = article(context, "kb_side_effects");
  const asksGeneral = /what (?:side effects|can)|common|normal/i.test(message) &&
    !/i |i'm|my |having|feeling|got /i.test(message);

  if (asksGeneral) {
    return {
      answer: sideEffectsArticle.body.join(" "),
      category: "side_effect",
      tone: "neutral",
      facts: [{ label: "Common reports", value: "Nausea, headache, dizziness, tiredness, sleep trouble" }],
      sources: [sideEffectsArticle.sourceFile],
    };
  }

  const openEffects = context.openCases
    .filter((item) => item.case_type === "side_effects")
    .map((item) => item.sub_type ?? "side effect");
  const effects = [...new Set([...context.recentSideEffects, ...openEffects])];
  const needsReview = effects.length > 0;

  return {
    answer:
      (effects.length
        ? `Your recent records mention ${effects.join(" and ")}. `
        : "I don’t see a current side effect recorded in Tier 1. ") +
      "Joyous guidance says common side effects can include nausea, headache, dizziness, tiredness, and trouble sleeping. Report symptoms in your check-in. If they are bothering you or persisting, the Nurse Team should review them. Do not change your dose based on this assistant.",
    category: "side_effect",
    tone: needsReview ? "attention" : "neutral",
    facts: [
      { label: "Recorded effects", value: effects.length ? effects.join(", ") : "None found", tone: needsReview ? "attention" : undefined },
    ],
    sources: source("checkins.json", openEffects.length ? "cases.json" : undefined, sideEffectsArticle.sourceFile),
    handoff: needsReview ? handoff("Nurse Team", "Recorded side effects need follow-up") : undefined,
  };
}

function answerDose(context: Tier1PatientContext, message: string): AssistantAnswer {
  const protocol = context.patient.protocol;
  const changeRequest = isDoseChangeRequest(message);

  if (!protocol) {
    return {
      answer:
        "There is no active treatment protocol or dose in your Tier 1 record. I can’t recommend a dose or assume that medication has been prescribed. The Care Team should clarify your treatment status.",
      category: "dose",
      tone: "attention",
      facts: [{ label: "Current dose", value: "None recorded", tone: "attention" }],
      sources: ["patient.json", "meetings.json"],
      handoff: handoff("Care Team", "No active protocol is recorded"),
    };
  }

  if (context.protocolIsHistorical) {
    const nextVisit = context.upcomingMeetings[0];
    return {
      answer:
        `Your account is in past-patient status. The ${protocol.dose ?? "—"} mg dose in the record is historical, not a current instruction. ` +
        (nextVisit ? `Your returning-patient visit is ${formatMeeting(nextVisit, context.patient.profile.timezone)}. ` : "") +
        "Do not restart or use leftover medication based on this assistant; your provider must give you a current plan.",
      category: "dose",
      tone: "attention",
      facts: [
        { label: "Historical dose", value: `${protocol.dose ?? "—"} mg` },
        { label: "Current authorization", value: "Not active", tone: "attention" },
      ],
      sources: source("patient.json", nextVisit ? "meetings.json" : undefined),
      handoff: handoff("Provider", "Returning patient needs a current medication plan"),
    };
  }

  if (protocol.hold_prescription) {
    return {
      answer:
        `Your record lists ${protocol.dose ?? "—"} mg, using a ${protocol.strength ?? "—"} mg troche, but the prescription is currently on hold. ` +
        "Do not increase, decrease, or otherwise change the dose based on this assistant. The Nurse Team needs to review the hold" +
        (context.safetyCase ? ` and the open ${context.safetyCase.risk ?? "elevated"}-risk follow-up` : "") + ".",
      category: "dose",
      tone: "urgent",
      facts: [
        { label: "Recorded dose", value: `${protocol.dose ?? "—"} mg` },
        { label: "Prescription", value: "On hold", tone: "urgent" },
      ],
      sources: source("patient.json", context.safetyCase ? "cases.json" : undefined),
      handoff: handoff("Nurse Team", "Dose request while prescription is on hold"),
    };
  }

  return {
    answer:
      `Your current Tier 1 protocol lists a ${protocol.dose ?? "—"} mg dose from a ${protocol.strength ?? "—"} mg troche` +
      (protocol.split_dose ? ", taken as a split dose" : "") + ". " +
      (changeRequest
        ? "I can report the recorded dose, but I cannot recommend changing it. A provider or Nurse Team member must make that decision."
        : "Follow the current instructions from your care team and report how it feels in your check-ins."),
    category: "dose",
    tone: changeRequest ? "attention" : "neutral",
    facts: [
      { label: "Dose", value: `${protocol.dose ?? "—"} mg` },
      { label: "Troche strength", value: `${protocol.strength ?? "—"} mg` },
      { label: "Check-ins", value: protocol.checkin ?? "Not set" },
    ],
    sources: ["patient.json"],
    handoff: changeRequest ? handoff("Provider", "Patient is asking to change the recorded dose") : undefined,
  };
}

function answerForm(context: Tier1PatientContext): AssistantAnswer {
  const idCase = context.openCases.find((item) => item.case_type === "hhh");
  const completed = context.forms.map((form) => form.flow_label.replaceAll("-", " "));

  if (idCase?.requirement === "government_photo_id") {
    return {
      answer:
        "Your intake form is complete, but the onboarding task says government photo ID is still required and has not been marked received. That is keeping the appointment on hold and blocking prescription creation. Use the secure account upload flow; if it is not working, the Care Team must help. Do not send identity documents in this demo chat.",
      category: "form",
      tone: "attention",
      facts: [
        { label: "Intake", value: "Complete" },
        { label: "Government ID", value: "Not marked received", tone: "attention" },
      ],
      sources: ["cases.json", "forms/intake_form.json", "meetings.json"],
      handoff: handoff("Care Team", "Identity verification is blocking onboarding"),
    };
  }

  return {
    answer:
      `Your Tier 1 record contains ${completed.length ? completed.join(" and ") : "no submitted forms"}. ` +
      "I can confirm what appears in the record, but this chat cannot accept identity documents or modify a submitted form.",
    category: "form",
    tone: "neutral",
    facts: context.forms.map((form) => ({
      label: form.flow_label.replaceAll("-", " "),
      value: form.finalized ? `Submitted ${formatDate(form.submitted_at)}` : "Not finalized",
    })),
    sources: context.forms.map((form) => form.sourceFile),
  };
}

function answerNextStep(context: Tier1PatientContext, message: string): AssistantAnswer {
  if (/approved|approval|account status|treatment status|my status/i.test(message)) {
    const meeting = context.latestMeeting;
    const status = lifecycleLabels[context.patient.status] ?? context.patient.status;
    const isDenied = context.patient.status === "not_approved";
    const isOnHold = context.patient.status === "onboarding" && meeting?.status === "Hold";
    const explanation = isDenied
      ? `Your current account status is not approved, and your latest visit is marked ${meeting?.status ?? "Denied"}. No active protocol is recorded.`
      : isOnHold
        ? "Your account is still onboarding, and your latest visit is on hold. No active protocol is recorded yet."
        : context.patient.status === "churned"
          ? "Your account is in past-patient status. Any prior protocol is historical rather than a current treatment instruction."
          : `Your account is in ${status} status.`;

    return {
      answer:
        explanation +
        (isDenied || isOnHold
          ? " Tier 1 does not include enough clinical detail to explain or change that decision; the Care Team should clarify next steps."
          : " Ask me what is open if you want a task-by-task summary."),
      category: "next_step",
      tone: isDenied || isOnHold ? "attention" : "neutral",
      facts: [
        { label: "Account status", value: status, tone: isDenied || isOnHold ? "attention" : undefined },
        ...(meeting ? [{ label: "Latest visit", value: meeting.status }] : []),
      ],
      sources: source("patient.json", meeting ? "meetings.json" : undefined),
      handoff: isDenied || isOnHold
        ? handoff("Care Team", "Treatment status or hold needs clarification")
        : undefined,
    };
  }

  const descriptions = context.actionableCases
    .map(describeCase)
    .filter((description): description is string => Boolean(description));
  const top = descriptions.slice(0, 3);
  const needsClinical = Boolean(context.safetyCase) || context.patient.protocol?.hold_prescription;

  if (!top.length) {
    return {
      answer:
        `Your account is currently in ${lifecycleLabels[context.patient.status]} status, and I do not see a specific outstanding Tier 1 task. ` +
        "You can ask about your dose, check-ins, appointments, shipments, or general Joyous policies.",
      category: "next_step",
      tone: "neutral",
      facts: [{ label: "Open action items", value: "None found" }],
      sources: ["patient.json", "cases.json"],
    };
  }

  return {
    answer:
      `The most important open item is: ${top[0]}.` +
      (top.length > 1 ? ` Other open items include: ${top.slice(1).join("; ")}.` : "") +
      " I can explain these records, but this demo cannot complete or transmit the task.",
    category: "next_step",
    tone: needsClinical ? "urgent" : "attention",
    facts: top.map((item, index) => ({
      label: index === 0 ? "Priority" : `Open item ${index + 1}`,
      value: item,
      tone: index === 0 ? (needsClinical ? "urgent" : "attention") : undefined,
    })),
    sources: ["cases.json", "patient.json"],
    handoff: needsClinical
      ? handoff("Nurse Team", "Clinical or safety action remains open")
      : handoff("Care Team", "Operational action remains open"),
  };
}

function answerGettingStarted(context: Tier1PatientContext): AssistantAnswer {
  const gettingStarted = article(context, "kb_getting_started");
  return {
    answer: gettingStarted.body.join(" "),
    category: "getting_started",
    tone: "neutral",
    facts: [
      { label: "Typical shipping", value: "3–6 business days after prescription is filled" },
      { label: "Starting point", value: "Usually one-quarter troche" },
    ],
    sources: [gettingStarted.sourceFile],
  };
}

function answerOverview(context: Tier1PatientContext): AssistantAnswer {
  const protocol = context.patient.protocol;
  const primaryAction = context.actionableCases.map(describeCase).find(Boolean);
  const status = lifecycleLabels[context.patient.status] ?? context.patient.status;
  const facts = [
    { label: "Status", value: status },
    ...(protocol && !context.protocolIsHistorical
      ? [{ label: "Recorded dose", value: `${protocol.dose ?? "—"} mg` }]
      : []),
    { label: "Open action items", value: String(context.actionableCases.length) },
  ];

  return {
    answer:
      `Hi ${context.patient.first_name}. Your Tier 1 account status is ${status}. ` +
      (primaryAction ? `The main open item I can see is: ${primaryAction}. ` : "I do not see a priority operational task. ") +
      "You can ask me about your treatment status, dose, next steps, appointments, shipments, check-ins, forms, billing policy, or side effects.",
    category: "overview",
    tone: context.safetyCase ? "urgent" : primaryAction ? "attention" : "neutral",
    facts,
    sources: ["patient.json", "cases.json"],
  };
}

export function answerPatientQuestion(
  context: Tier1PatientContext,
  message: string,
): AssistantAnswer {
  const intent = classifyIntent(message);
  let baseline: AssistantAnswer;

  switch (intent) {
    case "crisis":
      baseline = answerCrisis(context);
      break;
    case "third_party_safety":
      baseline = answerThirdPartySafety(context, message);
      break;
    case "urgent_medical":
      baseline = answerUrgentMedical(context);
      break;
    case "shipment":
      baseline = answerShipment(context);
      break;
    case "billing":
      baseline = answerBilling(context);
      break;
    case "appointment":
      baseline = answerAppointment(context);
      break;
    case "checkin":
      baseline = answerCheckins(context, message);
      break;
    case "side_effect":
      baseline = answerSideEffects(context, message);
      break;
    case "form":
      baseline = answerForm(context);
      break;
    case "dose":
      baseline = answerDose(context, message);
      break;
    case "next_step":
      baseline = answerNextStep(context, message);
      break;
    case "getting_started":
      baseline = answerGettingStarted(context);
      break;
    default:
      baseline = answerOverview(context);
  }

  const memoryAwareAnswer = applyConversationMemory(context, message, baseline);
  return applyClinicalContext(context, message, memoryAwareAnswer);
}
