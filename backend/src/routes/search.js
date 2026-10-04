const express = require("express");
const router = express.Router();
const { searchKnowledgeBase } = require("../services/retrievalService");

// GET /api/search?q=damaged item replacement
router.get("/", (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "validation_error", message: "Query param 'q' is required" });
  }
  const results = searchKnowledgeBase(query, { topK: 3 });
  res.json({ query, results });
});

module.exports = router;