// Simple demo-token authentication.
// Per the brief: "Implement simple authentication (demo token or login
// flow); full RBAC is Good-to-Have." A single shared bearer token is
// sufficient for this capstone's scope.

const DEMO_TOKEN = process.env.API_TOKEN || "trustdesk-demo-token";

function requireAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token || token !== DEMO_TOKEN) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Missing or invalid API token. Pass 'Authorization: Bearer <token>'.",
    });
  }

  next();
}

module.exports = { requireAuth, DEMO_TOKEN };