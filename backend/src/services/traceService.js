const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../db/connection");

function recordRun({ ticketId, runType, status, retrievedDocIds = [], toolCalls = [], guardrailResults = {} }) {
  const db = getDb();
  const run_id = `run_${uuidv4().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO agent_runs (run_id, ticket_id, run_type, status, retrieved_doc_ids, tool_calls, guardrail_results, created_at)
    VALUES (@run_id, @ticket_id, @run_type, @status, @retrieved_doc_ids, @tool_calls, @guardrail_results, @created_at)
  `).run({
    run_id,
    ticket_id: ticketId,
    run_type: runType,
    status,
    retrieved_doc_ids: JSON.stringify(retrievedDocIds),
    tool_calls: JSON.stringify(toolCalls),
    guardrail_results: JSON.stringify(guardrailResults),
    created_at: new Date().toISOString(),
  });
  db.close();
  return run_id;
}

function getRun(runId) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM agent_runs WHERE run_id = ?`).get(runId);
  db.close();
  if (!row) return null;
  return {
    ...row,
    retrieved_doc_ids: JSON.parse(row.retrieved_doc_ids || "[]"),
    tool_calls: JSON.parse(row.tool_calls || "[]"),
    guardrail_results: JSON.parse(row.guardrail_results || "{}"),
  };
}

module.exports = { recordRun, getRun };
