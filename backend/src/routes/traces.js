const express = require("express");
const router = express.Router();
const { getDb } = require("../db/connection");

// GET /api/traces?ticket_id=tkt_9001 (optional filter)
router.get("/", (req, res) => {
  const db = getDb();
  const { ticket_id } = req.query;
  const rows = ticket_id
    ? db.prepare(`SELECT * FROM agent_runs WHERE ticket_id = ? ORDER BY created_at DESC`).all(ticket_id)
    : db.prepare(`SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 100`).all();
  db.close();

  const traces = rows.map((r) => ({
    ...r,
    retrieved_doc_ids: JSON.parse(r.retrieved_doc_ids || "[]"),
    tool_calls: JSON.parse(r.tool_calls || "[]"),
    guardrail_results: JSON.parse(r.guardrail_results || "{}"),
  }));

  res.json({ traces });
});

// GET /api/eval-runs - list past eval runs (summary only)
router.get("/eval-runs", (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT eval_run_id, started_at, completed_at, total_cases, metrics FROM eval_runs ORDER BY started_at DESC`).all();
  db.close();
  res.json({ eval_runs: rows.map((r) => ({ ...r, metrics: JSON.parse(r.metrics || "{}") })) });
});

// GET /api/eval-runs/:id - full detail including per-case results
router.get("/eval-runs/:id", (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM eval_runs WHERE eval_run_id = ?`).get(req.params.id);
  db.close();
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({
    ...row,
    metrics: JSON.parse(row.metrics || "{}"),
    case_results: JSON.parse(row.case_results || "[]"),
  });
});

module.exports = router;