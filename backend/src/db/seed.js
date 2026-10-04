// Loads data/*.json + data/knowledge_base/*.md into SQLite.
// Preserves source IDs exactly (customer_id, order_id, ticket_id, doc_id, tool_name)
// because the evals depend on these IDs matching data/eval_cases.jsonl.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getDb, initSchema, DB_PATH } = require("./connection");

const DATA_DIR = path.join(__dirname, "..", "data");
const KB_DIR = path.join(DATA_DIR, "knowledge_base");

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// KB files look like:
//   # Title
//   Doc ID: KB-XXXX-001
function parseKbFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");
  const titleLine = lines.find((l) => l.trim().startsWith("#")) || "";
  const title = titleLine.replace(/^#+\s*/, "").trim() || path.basename(filePath, ".md");

  const docIdLine = lines.find((l) => /doc\s*id\s*:/i.test(l));
  const docIdMatch = docIdLine ? docIdLine.match(/doc\s*id\s*:\s*([A-Z0-9_-]+)/i) : null;
  const doc_id = docIdMatch ? docIdMatch[1].trim() : path.basename(filePath, ".md").toUpperCase();

  return {
    doc_id,
    title,
    content: raw,
    source_path: `data/knowledge_base/${path.basename(filePath)}`,
    version: "1.0",
    audience: "support_agent",
    updated_at: new Date().toISOString(),
    checksum: checksum(raw),
  };
}

function seed() {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log(`Removed existing DB at ${DB_PATH}`);
  }

  const db = getDb();
  initSchema(db);

  // --- Customers ---
  const customers = readJson("customers.json");
  const insertCustomer = db.prepare(`
    INSERT INTO customers (customer_id, name, email, tier, country, created_at, verified, tags)
    VALUES (@customer_id, @name, @email, @tier, @country, @created_at, @verified, @tags)
  `);
  const insertCustomers = db.transaction((rows) => {
    for (const c of rows) {
      insertCustomer.run({ ...c, verified: c.verified ? 1 : 0, tags: JSON.stringify(c.tags || []) });
    }
  });
  insertCustomers(customers);
  console.log(`Loaded ${customers.length} customers`);

  // --- Orders ---
  const orders = readJson("orders.json");
  const insertOrder = db.prepare(`
    INSERT INTO orders (order_id, customer_id, status, placed_at, delivered_at, eligible_return_until,
      total, currency, payment_status, tracking_number, items)
    VALUES (@order_id, @customer_id, @status, @placed_at, @delivered_at, @eligible_return_until,
      @total, @currency, @payment_status, @tracking_number, @items)
  `);
  const insertOrders = db.transaction((rows) => {
    for (const o of rows) insertOrder.run({ ...o, items: JSON.stringify(o.items || []) });
  });
  insertOrders(orders);
  console.log(`Loaded ${orders.length} orders`);

  // --- Tickets ---
  const tickets = readJson("tickets.json");
  const insertTicket = db.prepare(`
    INSERT INTO tickets (ticket_id, customer_id, order_id, channel, subject, body, created_at, status,
      expected_category, expected_priority, expected_sentiment, expected_escalation, expected_actions)
    VALUES (@ticket_id, @customer_id, @order_id, @channel, @subject, @body, @created_at, @status,
      @expected_category, @expected_priority, @expected_sentiment, @expected_escalation, @expected_actions)
  `);
  const insertTickets = db.transaction((rows) => {
    for (const t of rows) {
      insertTicket.run({
        ...t,
        status: t.status || "open",
        expected_escalation: t.expected_escalation ? 1 : 0,
        expected_actions: JSON.stringify(t.expected_actions || []),
      });
    }
  });
  insertTickets(tickets);
  console.log(`Loaded ${tickets.length} tickets`);

  // --- Tool catalog ---
  const tools = readJson("tool_actions.json");
  const insertTool = db.prepare(`
    INSERT INTO tool_catalog (tool_name, description, risk_level, requires_human_approval,
      allowed_categories, required_fields, max_amount_inr)
    VALUES (@tool_name, @description, @risk_level, @requires_human_approval,
      @allowed_categories, @required_fields, @max_amount_inr)
  `);
  const insertTools = db.transaction((rows) => {
    for (const t of rows) {
      insertTool.run({
        ...t,
        requires_human_approval: t.requires_human_approval ? 1 : 0,
        allowed_categories: JSON.stringify(t.allowed_categories || []),
        required_fields: JSON.stringify(t.required_fields || []),
        max_amount_inr: t.max_amount_inr ?? null,
      });
    }
  });
  insertTools(tools);
  console.log(`Loaded ${tools.length} tool actions`);

  // --- Knowledge base docs ---
  const kbFiles = fs.readdirSync(KB_DIR).filter((f) => f.endsWith(".md"));
  const insertDoc = db.prepare(`
    INSERT INTO knowledge_documents (doc_id, title, content, source_path, version, audience, updated_at, checksum)
    VALUES (@doc_id, @title, @content, @source_path, @version, @audience, @updated_at, @checksum)
  `);
  const insertDocs = db.transaction((docs) => {
    for (const d of docs) insertDoc.run(d);
  });
  const docs = kbFiles.map((f) => parseKbFile(path.join(KB_DIR, f)));
  insertDocs(docs);
  console.log(`Loaded ${docs.length} knowledge-base documents:`, docs.map((d) => d.doc_id).join(", "));

  db.close();
  console.log(`\nSeed complete. DB written to ${DB_PATH}`);
}

if (require.main === module) {
  seed();
}

module.exports = { seed };