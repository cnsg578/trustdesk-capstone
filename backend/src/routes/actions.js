const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { proposeAction, getAction, approveAction } = require("../services/actionService");

// POST /api/tickets/:id/actions
// Body: { tool_name, payload, idempotency_key? }
router.post("/:id/actions", (req, res) => {
  try {
    const { tool_name, payload, idempotency_key } = req.body || {};
    if (!tool_name) {
      return res.status(400).json({ error: "validation_error", message: "tool_name is required" });
    }
    const key = idempotency_key || `auto_${uuidv4()}`;
    const result = proposeAction({ ticketId: req.params.id, toolName: tool_name, payload, idempotencyKey: key });
    if (result.error) {
      return res.status(400).json(result);
    }
    res.status(result.deduplicated ? 200 : 201).json(result);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

// GET /api/actions/:actionId
router.get("/actions/:actionId", (req, res) => {
  const action = getAction(req.params.actionId);
  if (!action) return res.status(404).json({ error: "not_found" });
  res.json({ action });
});

// POST /api/actions/:actionId/approve
// Body: { decision: "approve" | "reject", reviewer_id?, reason? }
router.post("/actions/:actionId/approve", (req, res) => {
  try {
    const { decision, reviewer_id, reason } = req.body || {};
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "validation_error", message: "decision must be 'approve' or 'reject'" });
    }
    const result = approveAction({ actionId: req.params.actionId, reviewerId: reviewer_id, decision, reason });
    if (result.error === "not_found") {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

module.exports = router;