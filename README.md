# Joyous Tier 3 Patient Assistant

A working conversational web app for the Joyous Junior Product Manager patient-assistant exercise. It combines Tier 1 current records, Tier 2 conversation memory, and filtered Tier 3 clinical context.

## Run locally

Requirements:

- Node.js 20 or newer
- npm

Create or update `.env` with your OpenAI API key:

```dotenv
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5.6-luna
```

The repository includes an ignored `.env` file ready for the key and a committed `.env.example`. Restart the development server after changing either value.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verify the build

```bash
npm run typecheck
npm test
npm run build
```

## What is implemented

- All five synthetic patients
- Server-side loading of the 38 Tier 1 files, five Tier 2 conversation files, and five Tier 3 visit-note files
- Patient-ID allowlisting and record isolation
- Normalized treatment, task, appointment, shipment, check-in, form, and safety state
- Free-text intent routing
- OpenAI Responses API generation with structured output
- Bounded in-session conversation history
- Patient-isolated retrieval of relevant prior SMS and app threads
- Continuity for unresolved requests, prior staff replies, and recorded escalations
- Authority rules that make current Tier 1 records override historical conversation claims
- Detection of previously flagged assistant mistakes so they are not repeated
- Patient-safe summarization of internal staff activity
- Safe clinical-note normalization that excludes raw transcripts, clinical summaries, clinician identities, and internal note-to-file comments
- Query-aware retrieval of dated provider statements and sanitized clinical plan items
- Historical-plan labeling that never turns an old plan into a current medication instruction
- A separate offline Tier 3 product-learning stream over patient utterances
- An anonymized theme taxonomy with Tier 1 coverage, priority, and improvement recommendations
- An internal dashboard and aggregate-only research copilot at `/product-insights`; its analysis never changes live patient responses
- Patient-specific answers with source labels
- Structured fact cards and state-aware suggested prompts
- Deterministic crisis, urgent-symptom, and medication-change guardrails
- Explicit human-handoff notices that never pretend a message was sent
- Responsive desktop and mobile layouts
- Scenario tests for all five patient stories

The exercise date is fixed to **August 19, 2026** so relative account state remains consistent with the supplied dataset.

## Architecture

```text
React chat interface
        |
        v
POST /api/chat
        |
        v
Patient ID validation
        |
        v
JsonPatientRepository (server-side Tier 1 + Tier 2 + Tier 3)
        |
        v
Core normalization + conversation-memory normalization
        |
        v
Query-aware memory selection (up to 3 relevant threads)
        |
        v
Filtered clinical-context selection (up to 2 relevant visits)
        |
        v
Safety-first intent routing
        |
        v
Grounded answer + facts + sources + handoff state
```

The separate product-learning path is:

```text
Tier 3 visit transcripts
        |
        v
Patient utterances only
        |
        v
Deterministic theme aggregation
        |
        v
Anonymized coverage gaps + prioritized opportunities
        |
        v
Product and Clinical review before any Tier 1 change
```

The application reads the supplied JSON directly rather than adding a database. The repository boundary allows a future database or internal API to replace the filesystem implementation without changing the UI or response policy.

Only relevant slices of the selected patient's current record, up to three memory threads, and up to two filtered clinical visits are sent to OpenAI. The browser never receives raw patient JSON, raw visit transcripts, clinical summaries, internal note text, clinician identities, or the API key; arbitrary filesystem paths are rejected, and switching patients aborts in-flight requests and clears the visible chat.

Tier 1 structured records remain the source of current truth. Tier 2 messages explain what the patient asked, what staff previously confirmed, and what remains unanswered. Historical AI answers are treated as claims rather than facts, and a supplied review flag causes the assistant to prefer the corrected current record.

Tier 3 adds the documented reasoning behind dated provider decisions. It can explain why a decision was recorded, but it cannot diagnose, prescribe, or make an old plan current. Clinical evidence is attributed to its visit date and filtered before retrieval.

Tier 3 also powers an offline product-learning report. Deterministic rules analyze synthetic patient utterances without OpenAI, producing aggregate counts and authored paraphrases instead of raw quotes or identities. The internal research copilot receives only that de-identified aggregate report and compares recurring needs with current Tier 1 coverage. Nothing is promoted into the patient assistant without Product and Clinical review.

The current default is `gpt-5.6-luna`, configurable through `OPENAI_MODEL`. If `OPENAI_API_KEY` is absent or the API request fails, the app returns the existing deterministic grounded answer and labels it as a fallback.

## Useful demo prompts

### Maya — P1042

- “Where is my refill?”
- “Did the Care Team ever reply about my held package?”
- “What dose am I taking?”
- “Do I need another visit?”
- “Why did my provider move me to 45 mg?”

### Devon — P1108

- “When will my medication ship?”
- “Am I approved?”
- “Did anyone answer my last approval message?”
- “Am I being charged?”
- “Why did the provider deny treatment?”

### Ruth — P1203

- “Why haven’t I received anything when I was charged?”
- “What is blocking my treatment?”
- “What form is missing?”
- “Why can’t the provider prescribe yet?”
- “You previously told me medication would arrive. Is that still true?”

### Alex — P1266

- “This isn’t working. Can I take more?”
- “How are my scores trending?”
- “Why shouldn’t I increase my dose?”
- “Did anyone get my last message?”
- “I have been thinking about harming myself.”

### Tom — P1319

- “Can I restart at my old 60 mg dose?”
- “Did the Nurse Team answer my restart question?”
- “When is my returning visit?”
- “What is my account status?”
- “Why can’t I restart at 60 mg?”

## Safety model

The assistant reports existing information but does not prescribe, diagnose, approve treatment, issue refunds, replace shipments, or contact humans.

Crisis language and urgent physical symptoms bypass routine intent handling. Dose changes, prescription holds, returning-patient restart questions, worsening scores, side effects, identity verification, billing conflicts, and shipment exceptions generate explicit human-handoff states.

The prototype tells the user when a handoff is needed and also says that it was **not sent**, because no messaging integration exists.

## Current limitations

- OpenAI improves conversational phrasing for ordinary requests, while deterministic responses remain authoritative for crisis, urgent physical symptoms, and medication-change requests.
- Supplied Tier 2 history is read-only; new demo messages are not persisted across sessions.
- Tier 3 is explanatory and read-only; it does not expose raw transcripts or create clinical decisions.
- The internal product-insights route is a demo surface and does not yet have production authentication or role-based access control.
- Patient selection is a demo control, not production authentication.
- Booking, billing, carrier, pharmacy, and Care Team actions are read-only simulations.
- Safety review events are console-logged only; there is no production audit log, review queue, or persistence layer.
