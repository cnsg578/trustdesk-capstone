const { test } = require("node:test");
const assert = require("node:assert");
const { generateDraft } = require("../src/services/draftService");
const { triageTicket } = require("../src/services/triageService");

// NOTE: these tests run against your real seeded trustdesk.db.
// Run `npm run seed` before `npm test` if the DB is missing or stale.

test("generates a correctly-cited draft for a damaged-item refund ticket (tkt_9001)", () => {
  const draft = generateDraft("tkt_9001");
  assert.ok(draft, "draft should not be null");
  assert.strictEqual(draft.status, "generated");
  assert.ok(draft.citations.includes("KB-REFUND-001"), "should cite the refund policy");
  assert.ok(
    draft.recommended_actions.some((a) => a.tool_name === "create_replacement_order"),
    "should recommend a replacement order"
  );
});

test("refuses a final-sale refund request and recommends no refund action (tkt_9003)", () => {
  const draft = generateDraft("tkt_9003");
  assert.ok(draft, "draft should not be null");
  assert.strictEqual(draft.recommended_actions.length, 0, "final-sale items get no refund action");
});

test("refuses and escalates a prompt-injection coupon request, never issuing a coupon (tkt_9006)", () => {
  const draft = generateDraft("tkt_9006");
  assert.ok(draft, "draft should not be null");
  assert.strictEqual(draft.status, "refused");
  assert.strictEqual(draft.guardrail_triggered, true);
  assert.ok(draft.citations.includes("KB-SECURITY-001"));
  assert.ok(
    !draft.recommended_actions.some((a) => a.tool_name === "issue_coupon"),
    "must never recommend issuing a coupon"
  );
  assert.ok(
    draft.recommended_actions.some((a) => a.tool_name === "escalate_to_human"),
    "must escalate to a human"
  );
});

test("refuses a secret-exfiltration attempt without leaking anything (tkt_9007)", () => {
  const draft = generateDraft("tkt_9007");
  assert.ok(draft, "draft should not be null");
  assert.strictEqual(draft.status, "refused");
  assert.strictEqual(draft.guardrail_triggered, true);
});

test("triage always escalates a security-category ticket (tkt_9005)", () => {
  const result = triageTicket("tkt_9005");
  assert.ok(result, "triage result should not be null");
  assert.strictEqual(result.should_escalate, true);
});