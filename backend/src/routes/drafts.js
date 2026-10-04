const express = require("express");
const router = express.Router();
const { generateDraft } = require("../services/draftService");

// POST /api/tickets/:id/draft
router.post("/:id/draft", (req, res) => {
  try {
    const result = generateDraft(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "not_found", message: `Ticket ${req.params.id} not found` });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

module.exports = router;