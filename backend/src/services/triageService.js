const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../db/connection");
const { classifyTicket } = require("./aiAdapter");
const { recordRun } = require("./traceService");

function triageTicket(ticketId) {
  const db = getDb();
  const ticket = db.prepare(`SELECT * FROM tickets WHERE ticket_id = ?`).get(ticketId);
  db.close();

  if (!ticket) return null;

  // IMPORTANT: we only pass subject/body to the AI adapter — never the
  // expected_* seed labels. Those exist for evaluation only (per brief).
  const result = classifyTicket({ subject: ticket.subject, body: ticket.body });

  const run_id = recordRun({
    ticketId,
    runType: "triage",
    status: "completed",
    retrievedDocIds: [],
    toolCalls: [],
    guardrailResults: { triggered: false },
  });

  return { ticket_id: ticketId, ...result, run_id };
}

module.exports = { triageTicket };