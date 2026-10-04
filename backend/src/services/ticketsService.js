const { getDb } = require("../db/connection");

function parseTicketRow(row) {
  return {
    ...row,
    expected_escalation: !!row.expected_escalation,
    expected_actions: JSON.parse(row.expected_actions || "[]"),
  };
}

function listTickets() {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM tickets ORDER BY created_at ASC`).all();
  db.close();
  // Don't leak expected_* labels in the list view — they're for eval only.
  return rows.map((r) => ({
    ticket_id: r.ticket_id,
    customer_id: r.customer_id,
    order_id: r.order_id,
    channel: r.channel,
    subject: r.subject,
    status: r.status,
    created_at: r.created_at,
  }));
}

function getTicketWithContext(ticketId) {
  const db = getDb();
  const ticket = db.prepare(`SELECT * FROM tickets WHERE ticket_id = ?`).get(ticketId);
  if (!ticket) {
    db.close();
    return null;
  }

  const customer = ticket.customer_id
    ? db.prepare(`SELECT * FROM customers WHERE customer_id = ?`).get(ticket.customer_id)
    : null;
  const order = ticket.order_id
    ? db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(ticket.order_id)
    : null;

  db.close();

  const { expected_category, expected_priority, expected_sentiment, expected_escalation, expected_actions, ...publicTicket } = ticket;

  return {
    ticket: {
      ...publicTicket,
      // expected_* fields are intentionally excluded from the API response.
      // They exist only for the eval runner (see src/scripts/runEvals.js).
    },
    customer: customer ? { ...customer, verified: !!customer.verified, tags: JSON.parse(customer.tags || "[]") } : null,
    order: order ? { ...order, items: JSON.parse(order.items || "[]") } : null,
  };
}

module.exports = { listTickets, getTicketWithContext };