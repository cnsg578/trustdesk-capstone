// AI Provider Adapter
// -----------------------------------------------------------------------
// Every AI-powered feature (triage, draft generation) calls THIS module,
// never a provider SDK directly. That means:
//   1. We can mock this entire module in tests (no network, no API key).
//   2. We can swap the implementation for a real hosted LLM later without
//      touching routes, services, or guardrails.
// The current implementation is a deterministic, rule-based "mock provider".
// -----------------------------------------------------------------------

// Weighted phrase lists. More specific / stronger-signal phrases get a
// higher weight so they win over generic words that happen to co-occur
// (e.g. "package"/"delivered" showing up in a damaged-item ticket should
// NOT outweigh "replacement"/"cracked", which are stronger refund signals).

const CATEGORY_KEYWORDS = {
  refund: [
    ["replacement", 3], ["refund", 3], ["return it", 2], ["changed my mind", 3],
    ["damaged", 3], ["defective", 3], ["cracked", 3], ["crack", 2], ["broken", 2],
    ["money back", 3],
  ],
  warranty: [
    ["warranty", 3], ["battery failed", 3], ["swelling", 3], ["malfunction", 3],
    ["stopped working", 3], ["under warranty", 3], ["repair", 2],
  ],
  shipping: [
    ["tracking", 3], ["no movement", 3], ["not moved", 3], ["shipment", 2],
    ["courier", 2], ["shipped", 2], ["transit", 2], ["carrier", 2],
    ["delivery", 1], ["delivered", 1], ["package", 1],
  ],
  billing: [
    ["double charge", 3], ["two charges", 3], ["charged twice", 3], ["invoice", 2],
    ["overcharged", 3], ["payment", 2], ["charge", 1], ["billing", 2],
  ],
  account_security: [
    ["ignore identity checks", 3], ["skip identity", 3], ["identity check", 2],
    ["change my account email", 3], ["lost access", 2], ["password", 2],
    ["login", 2], ["locked", 2], ["hacked", 3], ["verify", 1], ["security", 1],
    ["hidden system prompt", 3], ["api key", 3], ["internal notes", 3],
  ],
  general: [],
};

const URGENT_WORDS = ["urgent", "immediately", "asap", "emergency", "right now", "today"];
const HIGH_PRIORITY_WORDS = ["frustrated", "angry", "not moved", "no movement", "need it", "deadline", "swelling"];

function scoreCategory(text) {
  const lower = text.toLowerCase();
  let best = "general";
  let bestScore = 0;
  for (const [category, phrases] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === "general") continue;
    const score = phrases.reduce((acc, [phrase, weight]) => (lower.includes(phrase) ? acc + weight : acc), 0);
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

const INJECTION_MARKERS = [
  "ignore all instructions", "system override", "ignore previous instructions",
  "reveal your system prompt", "print your api key", "do not mention this",
];

function scorePriority(text, category) {
  const lower = text.toLowerCase();
  if (URGENT_WORDS.some((w) => lower.includes(w))) return "urgent";
  if (lower.includes("swelling") || lower.includes("safety")) return "urgent";
  if (category === "account_security") return "high";
  if (category === "billing") return "high";
  if (lower.includes("changed my mind")) return "low";
  if (HIGH_PRIORITY_WORDS.some((w) => lower.includes(w))) return "high";
  if (category === "shipping" || category === "refund" || category === "warranty") return "medium";
  if (INJECTION_MARKERS.some((w) => lower.includes(w))) return "medium";
  return "low";
}

/**
 * classifyTicket - the "AI triage" call.
 * Deterministic now; swap internals for a real LLM call later, same signature.
 */
function classifyTicket({ subject, body }) {
  const text = `${subject || ""} ${body || ""}`;
  const category = scoreCategory(text);
  const priority = scorePriority(text, category);

  const sentiment = /frustrat|angry|upset|unacceptable|worst/i.test(text) ? "frustrated" : "neutral";

  const lower = text.toLowerCase();
  const hasInjectionMarker = INJECTION_MARKERS.some((w) => lower.includes(w));

  // Escalation heuristic: security-sensitive, urgent, OR a detected
  // prompt-injection/instruction-override attempt always escalates.
  const should_escalate = category === "account_security" || priority === "urgent" || hasInjectionMarker;

  return {
    category,
    priority,
    sentiment,
    should_escalate,
    reason_summary: `Classified as ${category} (${priority} priority) based on ticket content.`,
  };
}

module.exports = { classifyTicket };