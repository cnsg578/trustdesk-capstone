const express = require("express");
const router = express.Router();
const { listTickets, getTicketWithContext } = require("../services/ticketsService");

// GET /api/tickets - list all tickets
router.get("/", (req, res) => {
  try {
    const tickets = listTickets();
    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

// GET /api/tickets/:id - fetch one ticket with customer + order context
router.get("/:id", (req, res) => {
  try {
    const result = getTicketWithContext(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "not_found", message: `Ticket ${req.params.id} not found` });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

module.exports = router;