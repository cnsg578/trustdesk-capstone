const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../db/connection");
const { recordRun } = require("./traceService");

function getToolDefinition(toolName) {
  const db = getDb();
  const tool = db.prepare(`SELECT * FROM tool_catalog WHERE tool_name = ?`).get(toolName);
  db.close();
  if (!tool) return null;
  return {
    ...tool,
    requires_human_approval: !!tool.requires_human_approval,
    allowed_categories: JSON.parse(tool.allowed_categories || "[]"),
    required_fields: JSON.parse(tool.required_fields || "[]"),
  };
}

/**
 * proposeAction - creates a pending tool action recommended by the AI.
 * Nothing executes yet — this just records the recommendation with an
 * idempotency key, status "pending_approval".
 */
function proposeAction({ ticketId, toolName, payload, idempotencyKey }) {
  const tool = getToolDefinition(toolName);
  if (!tool) {
    return { error: "unknown_tool", message: `Tool '${toolName}' is not in the catalog.` };
  }

  const db = getDb();

  // Idempotency: if an action with this key already exists, return it
  // instead of creating a duplicate.
  const existing = db.prepare(`SELECT * FROM tool_actions WHERE idempotency_key = ?`).get(idempotencyKey);
  if (existing) {
    db.close();
    return { action: parseActionRow(existing), deduplicated: true };
  }

  const action_id = `act_${uuidv4().slice(0, 8)}`;
  const row = {
    action_id,
    ticket_id: ticketId,
    tool_name: toolName,
    payload: JSON.stringify(payload || {}),
    risk_level: tool.risk_level,
    requires_human_approval: tool.requires_human_approval ? 1 : 0,
    status: tool.requires_human_approval ? "pending_approval" : "approved",
    idempotency_key: idempotencyKey,
    created_at: new Date().toISOString(),
    executed_at: null,
    execution_result: null,
  };

  db.prepare(`
    INSERT INTO tool_actions (action_id, ticket_id, tool_name, payload, risk_level,
      requires_human_approval, status, idempotency_key, created_at, executed_at, execution_result)
    VALUES (@action_id, @ticket_id, @tool_name, @payload, @risk_level,
      @requires_human_approval, @status, @idempotency_key, @created_at, @executed_at, @execution_result)
  `).run(row);

  db.close();
  return { action: parseActionRow(row), deduplicated: false };
}

function parseActionRow(row) {
  return {
    ...row,
    requires_human_approval: !!row.requires_human_approval,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    execution_result: row.execution_result
      ? (typeof row.execution_result === "string" ? JSON.parse(row.execution_result) : row.execution_result)
      : null,
  };
}

function getAction(actionId) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM tool_actions WHERE action_id = ?`).get(actionId);
  db.close();
  return row ? parseActionRow(row) : null;
}

/**
 * approveAction - a human reviewer approves (or rejects) a pending action.
 * On approval, the action actually executes (simulated — writes an
 * execution_result and marks status "executed"). On rejection, marks
 * status "rejected" and nothing executes.
 */
function approveAction({ actionId, reviewerId, decision, reason }) {
  const db = getDb();
  const actionRow = db.prepare(`SELECT * FROM tool_actions WHERE action_id = ?`).get(actionId);
  if (!actionRow) {
    db.close();
    return { error: "not_found" };
  }

  if (actionRow.status === "executed" || actionRow.status === "rejected") {
    // Already finalized — idempotent no-op, return current state.
    db.close();
    return { action: parseActionRow(actionRow), already_finalized: true };
  }

  const approval_id = `appr_${uuidv4().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO approvals (approval_id, action_id, reviewer_id, decision, reason, created_at)
    VALUES (@approval_id, @action_id, @reviewer_id, @decision, @reason, @created_at)
  `).run({
    approval_id,
    action_id: actionId,
    reviewer_id: reviewerId || "demo_reviewer",
    decision,
    reason: reason || null,
    created_at: new Date().toISOString(),
  });

  let newStatus;
  let executionResult = null;
  let executedAt = null;

  if (decision === "approve") {
    newStatus = "executed";
    executedAt = new Date().toISOString();
    // Simulated execution — in a real system this would call the actual
    // refund/replacement service. We record a deterministic result so the
    // flow is demonstrable and auditable.
    executionResult = {
      simulated: true,
      tool_name: actionRow.tool_name,
      executed_at: executedAt,
      note: `Action '${actionRow.tool_name}' executed after human approval.`,
    };
  } else {
    newStatus = "rejected";
  }

  db.prepare(`
    UPDATE tool_actions SET status = ?, executed_at = ?, execution_result = ? WHERE action_id = ?
  `).run(newStatus, executedAt, executionResult ? JSON.stringify(executionResult) : null, actionId);

  const updatedRow = db.prepare(`SELECT * FROM tool_actions WHERE action_id = ?`).get(actionId);
  db.close();

  recordRun({
    ticketId: actionRow.ticket_id,
    runType: "tool_recommendation",
    status: "completed",
    retrievedDocIds: [],
    toolCalls: [actionRow.tool_name],
    guardrailResults: { triggered: false, decision },
  });

  return { action: parseActionRow(updatedRow), already_finalized: false };
}

module.exports = { proposeAction, getAction, approveAction, getToolDefinition };