# Joyous patient-assistant platform

A full-stack, safety-first demonstration of a grounded patient assistant and an isolated product-insights workspace. The repository contains a Next.js frontend, a dedicated Fastify API, PostgreSQL persistence, OpenAI response generation, deterministic clinical guardrails, role-gated access, and production container definitions.

All included patient records are synthetic. The scenario date is fixed to August 19, 2026.

## Architecture

```text
Browser
  └─ HTTPS → Next.js web application
                ├─ signed, HTTP-only role session
                └─ server-only BFF routes
                       └─ Bearer service credential → Fastify API
                              ├─ Zod request boundary
                              ├─ deterministic safety/authority engine
                              ├─ selected memory + clinical retrieval
                              ├─ OpenAI Responses API
                              └─ PostgreSQL
                                   ├─ patient source records
                                   ├─ chat sessions/messages
                                   └─ safety audit events
```

The browser never receives the backend service token, OpenAI key, raw source records, raw clinical transcripts, or arbitrary database access. Patient chat and Product Insights are separate roles. Current Tier 1 facts remain authoritative over Tier 2 history and dated Tier 3 plans.

## Local setup

Requirements: Node.js 20+, npm, and Docker Desktop.

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

Configure every placeholder in `.env`. Generate strong values with `openssl rand -base64 48`. The required variables are:

- `OPENAI_API_KEY` and `OPENAI_MODEL`
- `DATABASE_URL`
- `DATABASE_SSL_MODE` (`disable` locally; `verify-full` when the managed provider supplies a trusted certificate)
- `BACKEND_API_URL` and `BACKEND_SERVICE_TOKEN`
- `APP_SESSION_SECRET`
- `PATIENT_ACCESS_PASSWORD` and `PRODUCT_ACCESS_PASSWORD`

Open [http://localhost:3000](http://localhost:3000), choose a workspace, and use its configured password. The API readiness endpoint is [http://localhost:4000/health/ready](http://localhost:4000/health/ready).

## Run the containerized stack

After configuring `.env`:

```bash
docker compose up --build
```

Compose starts PostgreSQL, applies migrations, seeds the synthetic source records, starts the API on port 4000, and starts the web application on port 3000. PostgreSQL and the API bind only to loopback; containers run as non-root with read-only filesystems and health checks.

## Verification

```bash
npm run typecheck
npm test -- --run
npm run build:api
npm run build
npm audit --omit=dev
```

GitHub Actions runs the same type, test, and production-build checks on pushes and pull requests. API tests cover service authentication, payload validation, health/readiness, normalized patient records, deterministic crisis handling, durable exchange contracts, and aggregate Product Insights.

## Runtime behavior

Patient assistant:

- Reads normalized Tier 1, Tier 2 memory, and filtered Tier 3 clinical context from PostgreSQL.
- Selects only relevant context before calling OpenAI.
- Uses GPT-5.6 Luna by default for grounded conversational phrasing.
- Bypasses the model for crisis, urgent medical, and medication-change guardrails.
- Never claims to prescribe, diagnose, contact a team, replace a shipment, issue a refund, or complete an operational action.
- Persists every exchange and creates a distinct safety audit event when review is required.

Product Insights:

- Aggregates patient utterance themes offline and compares them with current Tier 1 coverage.
- Sends only the de-identified aggregate report—not raw transcripts—to its insights copilot.
- Cannot alter live patient behavior; findings require Product and Clinical review.

If OpenAI is unavailable, the API returns the deterministic grounded baseline and labels it as a fallback. Request IDs, structured redacted logs, rate limits, strict service authentication, repository isolation, and database health checks are enabled at the backend boundary.

## Database lifecycle

Migration files live in `backend/migrations` and are applied exactly once through the `app_migrations` table.

```bash
npm run db:migrate
npm run db:seed
```

The seed command is idempotent and intended for this synthetic demonstration. In a production integration, replace it with controlled ingestion from the source-of-truth patient, messaging, clinical, and fulfillment systems.

## Deployment topology

Deploy the API container and managed PostgreSQL in the same private region, then deploy the Next.js app on Vercel or as the web container. Configure:

- Web: `BACKEND_API_URL`, `BACKEND_SERVICE_TOKEN`, and the three access/session secrets.
- API: `DATABASE_URL`, `BACKEND_SERVICE_TOKEN`, `FRONTEND_ORIGIN`, `OPENAI_API_KEY`, and `OPENAI_MODEL`.
- Network: expose only API HTTPS publicly, restrict CORS to the exact web origin, and keep PostgreSQL private.

Run migrations as a release step before switching traffic. Confirm `/health/ready`, perform patient and Product Insights smoke tests, verify persisted session/message counts, then monitor 5xx rate, model fallback rate, latency, rate-limit events, and safety-review events.

## Production gaps before real patient data

This is a professional synthetic-data platform, not a HIPAA production authorization. Before using real patient data, replace the workspace passwords with organization OIDC/SSO and patient-bound authorization, use a managed secret store and encrypted managed PostgreSQL with backups, connect safety handoffs to a staffed review queue with escalation SLAs, establish vendor BAAs and retention/deletion policies, add distributed tracing and alerting, and complete clinical, privacy, security, accessibility, load, and disaster-recovery reviews.
