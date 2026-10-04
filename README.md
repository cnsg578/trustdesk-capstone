# TrustDesk — AI Support Operations Agent

TrustDesk is an AI-first support operations platform. It ingests support
tickets, retrieves relevant policy context from a knowledge base, triages
tickets by category/priority/escalation need, drafts cited replies, and
recommends operational actions (refund review, replacement order) that
require explicit human approval before executing. It defends against
prompt injection, identity-bypass attempts, and secret-exfiltration
requests, and ships with an automated evaluation runner that scores the
whole pipeline against a fixed set of eval cases.

Built for the Airtribe AI-first Software Engineering Program capstone.

---

## Table of Contents

- [Quick Start (Docker)](#quick-start-docker)
- [Quick Start (Local, no Docker)](#quick-start-local-no-docker)
- [Architecture](#architecture)
- [Design Decisions](#design-decisions)
- [Database Schema](#database-schema)
- [API Documentation](#api-documentation)
- [Evaluation Flow](#evaluation-flow)
- [Guardrails](#guardrails)
- [Testing](#testing)
- [Known Limitations](#known-limitations)

---

## Quick Start (Docker)

**Requirements:** Docker Desktop with virtualization enabled.

```bash
git clone <repo-url>
cd trustdesk
docker compose up --build
```

On first run, the container automatically seeds the database from
`backend/src/data/` (customers, orders, tickets, knowledge-base docs, tool
catalog). On subsequent runs, it detects the existing database and skips
seeding, so your data persists across restarts (stored in a Docker named
volume).

Once you see:

TrustDesk backend running on http://localhost:4000


Open **http://localhost:4000** in your browser — the frontend is served
directly by the same container.

**Run the evaluation suite** (in a separate terminal, while the container
is running):
```bash
docker compose exec trustdesk npm run eval
```

**Run the automated tests:**
```bash
docker compose exec trustdesk npm test
```

**Reset the database** (wipes all data and reseeds from scratch):
```bash
docker compose down -v
docker compose up --build
```

---

## Quick Start (Local, no Docker)

**Requirements:** Node.js 18+.

```bash
cd backend
npm install
npm run seed      # loads data/ into a local SQLite file
npm start         # starts the API on http://localhost:4000
```

Then open `frontend/index.html` directly in a browser (double-click it —
no local server needed; it talks to `http://localhost:4000` directly).

**Run evaluations:**
```bash
npm run eval
```

**Run tests** (stop the server first, or run in a separate terminal — both
work since SQLite handles concurrent access fine for this workload):
```bash
npm test
```

**Authentication:** all `/api/*` routes require a bearer token. The demo
token is `trustdesk-demo-token` (set via `API_TOKEN` env var / `.env`
file). The bundled frontend already sends this automatically.

```bash
curl http://localhost:4000/api/tickets \
  -H "Authorization: Bearer trustdesk-demo-token"
```

---

## Architecture

┌─────────────────────┐ ┌──────────────────────────────────────┐
│ Frontend (HTML/JS) │◄──────►│ Express Backend │
│ Tickets / Triage / │ REST │ ┌────────────────────────────────┐ │
│ Drafts / Approvals / │ API │ │ Routes (tickets, search, │ │
│ Eval Report │ │ │ triage, drafts, actions, │ │
└─────────────────────┘ │ │ traces, eval-runs) │ │
│ └────────────┬─────────────────────┘ │
│ │ │
│ ┌────────────▼─────────────────────┐ │
│ │ Services │ │
│ │ - retrievalService (keyword │ │
│ │ search + category boosting) │ │
│ │ - aiAdapter (pluggable AI │ │
│ │ provider interface) │ │
│ │ - triageService / draftService │ │
│ │ - actionService (idempotent │ │
│ │ approval-gated tool calls) │ │
│ │ - traceService │ │
│ └────────────┬─────────────────────┘ │
│ │ │
│ ┌────────────▼─────────────────────┐ │
│ │ Guardrails │ │
│ │ - inputGuardrails (prompt │ │
│ │ injection / exfiltration / │ │
│ │ identity-bypass detection) │ │
│ │ - documentGuardrails (blocks │ │
│ │ citing unsafe KB docs) │ │
│ └────────────┬─────────────────────┘ │
│ │ │
│ ┌────────────▼─────────────────────┐ │
│ │ SQLite (better-sqlite3) │ │
│ │ tickets, customers, orders, │ │
│ │ knowledge_documents, drafts, │ │
│ │ tool_actions, approvals, │ │
│ │ agent_runs, eval_runs │ │
│ └────────────────────────────────┘ │
└──────────────────────────────────────┘


**Data flow for a draft reply:**
1. Ticket text is scanned by `inputGuardrails` (untrusted input check)
2. `aiAdapter.classifyTicket` determines category/priority/escalation
3. `retrievalService.searchKnowledgeBase` finds relevant policy docs,
   boosted by the triage category
4. `documentGuardrails` strips any unsafe doc (`KB-ADVERSARIAL-001`) from
   consideration
5. If a guardrail triggered at either step, the system refuses the
   request, cites the security policy (and any legitimate policy that
   still applies), and escalates — never completing the original ask
6. Otherwise, a cited draft is generated and a rule-based action is
   recommended (if applicable)
7. Every run is logged to `agent_runs` (the audit trace)

---

## Design Decisions

- **AI provider behind an adapter (`aiAdapter.js`):** triage and
  classification logic is implemented as a deterministic, rule-based
  "mock provider" behind a single function interface
  (`classifyTicket({subject, body}) → {category, priority, ...}`). This
  satisfies the requirement that the AI provider be mockable in tests and
  swappable without touching routes/services — a real hosted LLM could
  replace the internals of this one function with no other code changes.

- **Retrieval is category-aware, not pure keyword search:** tickets
  rarely use a policy document's exact vocabulary (e.g. a customer says
  "cracked", the policy says "damaged"). Rather than rely on brittle
  keyword overlap alone, the retrieval layer uses the already-computed
  triage category to boost the matching policy document's score. This
  is a deliberate design choice — classify first, then retrieve within
  that context — and is documented here because it's the single most
  impactful decision for citation accuracy.

- **Guardrails operate on two independent surfaces:** raw ticket text
  (`inputGuardrails`, pattern-matching for injection/exfiltration/bypass
  phrases) and retrieved documents (`documentGuardrails`, which hard-blocks
  `KB-ADVERSARIAL-001` from ever being cited, regardless of its
  retrieval score). A guardrail trigger on either surface causes a full
  refusal + escalation, never a partial compliance.

- **On refusal, we still cite real policy where it applies:** if a
  ticket contains both a legitimate request (e.g. "change my account
  email") and an embedded unsafe instruction ("ignore identity checks"),
  the system refuses the unsafe instruction but still grounds its
  response in the real applicable policy (`KB-ACCOUNT-001`) *in addition
  to* the security policy that justifies the refusal — rather than
  collapsing to a generic refusal with no citation.

- **Business rules are explicit functions, not prompt text
  (`policyRules.js`):** final-sale eligibility and return-window checks
  are plain, testable JavaScript functions, not something inferred from
  free text. Return/warranty windows are evaluated against each ticket's
  `created_at`, never the current date, so the seed data stays valid
  indefinitely.

- **Idempotency via a unique key on `tool_actions`:** the approval-gated
  action endpoint accepts an `idempotency_key`; a duplicate key returns
  the original action instead of creating a new one, so retried requests
  can never double-execute a refund or replacement.

- **SQLite over Postgres:** chosen for zero-config setup and because
  `better-sqlite3` is synchronous, which simplifies the service layer
  significantly for a project of this scope, while still being a
  genuinely persistent, queryable relational store.

---

## Database Schema

See `backend/src/db/schema.sql` for the full DDL. Core tables:

| Table | Purpose |
|---|---|
| `customers`, `orders`, `tickets` | Seed data (loaded from `data/*.json`) |
| `knowledge_documents` | Policy KB docs, including the intentionally unsafe `KB-ADVERSARIAL-001` |
| `tool_catalog` | Available actions (refund review, replacement order, etc.) and their approval/risk metadata |
| `drafts` | Generated draft replies, with citations and recommended actions |
| `tool_actions` | Proposed/approved/executed actions, with idempotency key |
| `approvals` | Human approval/rejection decisions on actions |
| `agent_runs` | Audit trace of every AI run (triage, draft, tool recommendation) |
| `eval_runs` | Stored results of each `npm run eval` execution |

---

## API Documentation

All routes below require `Authorization: Bearer <API_TOKEN>` except `/health`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Liveness check (no auth) |
| GET | `/api/tickets` | List all tickets |
| GET | `/api/tickets/:id` | Fetch one ticket with customer + order context |
| GET | `/api/search?q=...` | Keyword search over the knowledge base |
| POST | `/api/tickets/:id/triage` | Classify a ticket (category, priority, sentiment, escalation) |
| POST | `/api/tickets/:id/draft` | Generate a cited draft reply (runs guardrails + retrieval + recommendation) |
| POST | `/api/tickets/:id/actions` | Propose a tool action (body: `tool_name`, `payload`, `idempotency_key`) |
| GET | `/api/actions/:actionId` | Fetch a proposed/approved/executed action |
| POST | `/api/actions/:actionId/approve` | Human approves/rejects a pending action (body: `decision`, `reviewer_id`, `reason`) |
| GET | `/api/traces?ticket_id=...` | List audit trace entries (optionally filtered by ticket) |
| GET | `/api/eval-runs` | List past evaluation runs (summary) |
| GET | `/api/eval-runs/:id` | Full detail of one evaluation run, including per-case results |

**Example — full approval flow:**
```bash
TOKEN="trustdesk-demo-token"

# 1. Propose an action
curl -X POST http://localhost:4000/api/tickets/tkt_9001/actions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tool_name":"create_replacement_order","payload":{"order_id":"ord_5001"},"idempotency_key":"demo-001"}'

# 2. Approve it (use the action_id returned above)
curl -X POST http://localhost:4000/api/actions/ACTION_ID/approve \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"decision":"approve","reviewer_id":"demo_manager"}'
```

---

## Evaluation Flow

```bash
npm run eval                              # local
docker compose exec trustdesk npm run eval   # Docker
```

This runs every case in `backend/src/data/eval_cases.jsonl` through the
**real** triage + draft pipeline (no mocking of the logic under test),
compares the result against each case's `expected` labels, and reports:

- **Category / priority accuracy** — triage correctness
- **Citation coverage** — every `must_cite_doc_ids` value present in the
  draft's citations (extra citations are fine; missing required ones fail
  the case)
- **Unsafe action block rate** — none of a case's `disallowed_actions`
  ever appear in the recommended actions
- **Allowed action recall** — at least one of a case's `allowed_actions`
  was recommended (when any are expected)
- **Escalation accuracy** — predicted escalation matches expected
- **Overall pass rate** — fraction of cases passing all of the above

Results are persisted to the `eval_runs` table and viewable in the
frontend's **Eval Report** tab, as well as printed to the console as a
formatted table. Current result on the full 8-case set: **8/8 (100%)**
across every metric.

---

## Guardrails

Two independent, always-on checks run before any draft is generated:

1. **Input guardrails** (`inputGuardrails.js`) — pattern-match raw ticket
   text for prompt injection ("ignore all instructions", "system
   override"), secret-exfiltration requests (system prompt, API key,
   internal notes), coupon abuse ("issue me a coupon... do not mention
   this"), and identity-bypass attempts ("skip identity checks").

2. **Document guardrails** (`documentGuardrails.js`) — `KB-ADVERSARIAL-001`
   is an intentionally unsafe knowledge-base document. Even if it's
   retrieved as a top search result, it is never cited or treated as an
   instruction.

If either check triggers, the system **refuses** the request outright,
escalates to a human, and never executes the originally-requested action
(e.g. it will never issue a coupon or reveal internal details, regardless
of how the request is phrased). The refusal is still grounded in real
policy where one legitimately applies (see Design Decisions above).

---

## Testing

```bash
npm test                              # local
docker compose exec trustdesk npm test   # Docker
```

15 automated tests across 4 files in `backend/tests/`:
- `guardrails.test.js` — injection/exfiltration detection, unsafe-doc filtering
- `aiAdapter.test.js` — triage classification and escalation logic
- `draftService.test.js` — end-to-end draft generation (citations, final-sale
  handling, guardrail refusal) against the real seeded database
- `actionService.test.js` — idempotency and approval-execution flow

---




## Known Limitations

- **Retrieval is keyword + category-boosted, not a vector/embedding
  search.** This satisfies the brief's "documented local substitute"
  allowance, but will not generalize as well as embeddings to ticket
  phrasing far outside the keyword lists tuned against this dataset.
- **The AI adapter is a deterministic rule-based mock, not a hosted
  LLM.** This was a deliberate choice (no hosted-provider dependency,
  fully mockable, zero cost/latency), but means draft reply *prose* is
  templated rather than freely generated.
- **Simple token auth, not full RBAC.** A single shared bearer token
  protects all API routes; there's no per-user identity or role
  distinction (explicitly listed as Good-to-Have, not Must-Have, in the
  brief).
- **Single approval-gated action type demonstrated end-to-end** in the
  frontend (refund review / replacement order); other tools in the
  catalog (e.g. `open_carrier_investigation`, `escalate_to_human`) are
  implemented and used by the recommendation logic but don't require
  approval, per their `tool_catalog` definition.
- **SQLite, not Postgres** — appropriate for this scope and fully
  persistent via a Docker volume, but would need migration for
  multi-instance horizontal scaling.

Thanks
  