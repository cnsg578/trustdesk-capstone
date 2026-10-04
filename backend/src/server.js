require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { requireAuth } = require("./middleware/auth");

const ticketsRouter = require("./routes/tickets");
const searchRouter = require("./routes/search");
const triageRouter = require("./routes/triage");
const draftsRouter = require("./routes/drafts");
const actionsRouter = require("./routes/actions");
const tracesRouter = require("./routes/traces");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;

// Serve the frontend as static files (works both locally and in Docker).
app.use(express.static(path.join(__dirname, "..", "..", "frontend")));
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use("/api/traces", tracesRouter);
app.use("/api", tracesRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "trustdesk-backend" });
});

app.use("/api/tickets", requireAuth, ticketsRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/tickets", requireAuth, triageRouter);
app.use("/api/tickets", requireAuth, draftsRouter);
app.use("/api/tickets", requireAuth, actionsRouter);
app.use("/api", requireAuth, actionsRouter);
app.use("/api/traces", requireAuth, tracesRouter);
app.use("/api", requireAuth, tracesRouter);

app.use("/api/tickets", ticketsRouter);
app.use("/api/search", searchRouter);
app.use("/api/tickets", triageRouter);
app.use("/api/tickets", draftsRouter);
app.use("/api/tickets", actionsRouter); // handles /api/tickets/:id/actions
app.use("/api", actionsRouter);         // handles /api/actions/:id and /api/actions/:id/approve

app.use((req, res) => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`TrustDesk backend running on http://localhost:${PORT}`);
});