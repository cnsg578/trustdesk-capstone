const { test } = require("node:test");
const assert = require("node:assert");
const { proposeAction, approveAction } = require("../src/services/actionService");

test("proposing an action twice with the same idempotency key does not create a duplicate", () => {
  const key = `test-idem-${Date.now()}`;
  const first = proposeAction({
    ticketId: "tkt_9002",
    toolName: "open_carrier_investigation",
    payload: { order_id: "ord_5002" },
    idempotencyKey: key,
  });
  const second = proposeAction({
    ticketId: "tkt_9002",
    toolName: "open_carrier_investigation",
    payload: { order_id: "ord_5002" },
    idempotencyKey: key,
  });

  assert.strictEqual(first.deduplicated, false);
  assert.strictEqual(second.deduplicated, true);
  assert.strictEqual(first.action.action_id, second.action.action_id);
});

test("approving a pending action executes it exactly once, re-approval is a no-op", () => {
  const key = `test-approve-${Date.now()}`;
  const { action } = proposeAction({
    ticketId: "tkt_9002",
    toolName: "open_carrier_investigation",
    payload: {},
    idempotencyKey: key,
  });

  const first = approveAction({ actionId: action.action_id, reviewerId: "tester", decision: "approve" });
  assert.strictEqual(first.action.status, "executed");
  assert.strictEqual(first.already_finalized, false);

  const second = approveAction({ actionId: action.action_id, reviewerId: "tester", decision: "approve" });
  assert.strictEqual(second.already_finalized, true);
  assert.strictEqual(second.action.status, "executed");
});