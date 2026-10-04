const express = require("express");
const router = express.Router();
const { triageTicket } = require("../services/triageService");

// POST /api/tickets/:id/triage
router.post("/:id/triage", (req, res) => {
  try {
    const result = triageTicket(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "not_found", message: `Ticket ${req.params.id} not found` });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

module.exports = router;