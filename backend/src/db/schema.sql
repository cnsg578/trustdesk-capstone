-- TrustDesk schema (SQLite)

CREATE TABLE IF NOT EXISTS customers (
  customer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  tier TEXT,
  country TEXT,
  created_at TEXT,
  verified INTEGER,
  tags TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT,
  placed_at TEXT,
  delivered_at TEXT,
  eligible_return_until TEXT,
  total REAL,
  currency TEXT,
  payment_status TEXT,
  tracking_number TEXT,
  items TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  ticket_id TEXT PRIMARY KEY,
  customer_id TEXT,
  order_id TEXT,
  channel TEXT,
  subject TEXT,
  body TEXT,
  created_at TEXT,
  status TEXT,
  expected_category TEXT,
  expected_priority TEXT,
  expected_sentiment TEXT,
  expected_escalation INTEGER,
  expected_actions TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  doc_id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  source_path TEXT,
  version TEXT,
  audience TEXT,
  updated_at TEXT,
  checksum TEXT
);

CREATE TABLE IF NOT EXISTS tool_catalog (
  tool_name TEXT PRIMARY KEY,
  description TEXT,
  risk_level TEXT,
  requires_human_approval INTEGER,
  allowed_categories TEXT,
  required_fields TEXT,
  max_amount_inr REAL
);

CREATE TABLE IF NOT EXISTS drafts (
  draft_id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  status TEXT,
  body TEXT,
  citations TEXT,
  recommended_actions TEXT,
  created_at TEXT,
  FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id)
);

CREATE TABLE IF NOT EXISTS tool_actions (
  action_id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  payload TEXT,
  risk_level TEXT,
  requires_human_approval INTEGER,
  status TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT,
  executed_at TEXT,
  execution_result TEXT,
  FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id)
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY,
  action_id TEXT,
  reviewer_id TEXT,
  decision TEXT,
  reason TEXT,
  created_at TEXT,
  FOREIGN KEY (action_id) REFERENCES tool_actions(action_id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  ticket_id TEXT,
  run_type TEXT,
  status TEXT,
  retrieved_doc_ids TEXT,
  tool_calls TEXT,
  guardrail_results TEXT,
  created_at TEXT,
  FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id)
);

CREATE TABLE IF NOT EXISTS eval_runs (
  eval_run_id TEXT PRIMARY KEY,
  started_at TEXT,
  completed_at TEXT,
  total_cases INTEGER,
  metrics TEXT,
  case_results TEXT
);