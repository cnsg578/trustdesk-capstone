const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../db/connection");
const { searchKnowledgeBase } = require("./retrievalService");
const { classifyTicket } = require("./aiAdapter");
const { recordRun } = require("./traceService");
const { isFinalSaleOrder, isWithinReturnWindow } = require("./policyRules");
const { checkInputGuardrails } = require("../guardrails/inputGuardrails");
const { filterUnsafeDocuments } = require("../guardrails/documentGuardrails");

const MIN_CITATION_SCORE = 0.1; // below this, we don't trust the match enough to answer

function loadTicketBundle(ticketId) {
  const db = getDb();
  const ticket = db.prepare(`SELECT * FROM tickets WHERE ticket_id = ?`).get(ticketId);
  if (!ticket) {
    db.close();
    return null;
  }
  const customer = ticket.customer_id
    ? db.prepare(`SELECT * FROM customers WHERE customer_id = ?`).get(ticket.customer_id)
    : null;
  const orderRow = ticket.order_id
    ? db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(ticket.order_id)
    : null;
  const order = orderRow ? { ...orderRow, items: JSON.parse(orderRow.items || "[]") } : null;
  db.close();
  return { ticket, customer, order };
}

function getToolCatalog() {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM tool_catalog`).all();
  db.close();
  return rows.map((r) => ({
    ...r,
    requires_human_approval: !!r.requires_human_approval,
    allowed_categories: JSON.parse(r.allowed_categories || "[]"),
    required_fields: JSON.parse(r.required_fields || "[]"),
  }));
}

// Decide which action(s) to recommend, given category + order-level facts.
// This is deliberately rule-based and explicit, not left to free-text generation.
function recommendActions({ category, ticket, order }) {
  const catalog = getToolCatalog();
  const byName = (name) => catalog.find((t) => t.tool_name === name);

  if (category === "refund") {
    if (isFinalSaleOrder(order)) {
      // Final-sale items are never eligible — no action recommended.
      return [];
    }
    const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
    const isDamaged = /damaged|defective|crack|broken/.test(text);
    if (isDamaged && isWithinReturnWindow(order, ticket.created_at)) {
      const tool = byName("create_replacement_order");
      return tool
        ? [{ tool_name: tool.tool_name, requires_human_approval: tool.requires_human_approval, reason: "Damaged item reported within the return window." }]
        : [];
    }
    const tool = byName("start_refund_review");
    return tool
      ? [{ tool_name: tool.tool_name, requires_human_approval: tool.requires_human_approval, reason: "Refund requested; starting human-reviewed refund workflow." }]
      : [];
  }

  if (category === "warranty") {
    const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
    if (/swelling|safety|fire|smoke/.test(text)) {
      // Safety issue -> escalate, don't self-serve a replacement.
      const tool = byName("escalate_to_human");
      return tool
        ? [{ tool_name: tool.tool_name, requires_human_approval: tool.requires_human_approval, reason: "Potential safety issue (battery swelling) — escalating to a human specialist." }]
        : [];
    }
    return [];
  }

  if (category === "shipping") {
    const tool = byName("open_carrier_investigation");
    return tool
      ? [{ tool_name: tool.tool_name, requires_human_approval: tool.requires_human_approval, reason: "Tracking shows no recent movement." }]
      : [];
  }

  if (category === "billing") {
    const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
    if (/double|twice|duplicate/.test(text)) {
      const tool = byName("start_refund_review");
      return tool
        ? [{ tool_name: tool.tool_name, requires_human_approval: tool.requires_human_approval, reason: "Possible duplicate charge; starting refund review." }]
        : [];
    }
    return [];
  }

  if (category === "account_security") {
    const tool = byName("escalate_to_human");
    return tool
      ? [{ tool_name: tool.tool_name, requires_human_approval: tool.requires_human_approval, reason: "Account/security requests are escalated for identity verification." }]
      : [];
  }

  return [];
}

function buildDraftBody({ category, ticket, customer, order, citations, finalSale }) {
  const name = customer ? customer.name.split(" ")[0] : "there";
  const citeText = citations.length ? ` (see ${citations.join(", ")})` : "";

  if (finalSale) {
    return `Hi ${name}, thank you for reaching out. I checked your order and this item is marked as a final-sale digital product, which is not eligible for a refund under our policy${citeText}. I'm sorry I can't process a refund here, but let me know if you have any other questions.`;
  }

  switch (category) {
    case "refund":
      return `Hi ${name}, I'm sorry to hear about the issue with your order. Based on our return and replacement policy${citeText}, I've started the appropriate process for your case below. A member of our team will review and confirm shortly.`;
    case "warranty":
      return `Hi ${name}, thanks for letting us know. I understand this is concerning. Based on our warranty policy${citeText}, I'm escalating this to a specialist so it can be handled safely and promptly.`;
    case "shipping":
      return `Hi ${name}, I'm sorry your package hasn't moved recently. Per our shipping policy${citeText}, I've opened a carrier investigation. I can't guarantee a resolution time yet, but we'll follow up as soon as we hear back from the carrier.`;
    case "billing":
      return `Hi ${name}, thanks for flagging this. I can see the charge you're referring to. Per our billing policy${citeText}, I've started a review of this transaction and will update you once it's resolved.`;
    case "account_security":
      return `Hi ${name}, for your account's security, I'm unable to make this change without completing identity verification first, per our account security policy${citeText}. I've escalated this ticket so a specialist can verify your identity and assist safely.`;
    default:
      return `Hi ${name}, thanks for reaching out. I've reviewed your message${citeText} and I'm routing this to the right team to help further.`;
  }
}

function generateDraft(ticketId) {
  const bundle = loadTicketBundle(ticketId);
  if (!bundle) return null;
  const { ticket, customer, order } = bundle;

  const ticketText = `${ticket.subject} ${ticket.body}`;

  // --- GUARDRAIL CHECK 1: scan the raw ticket text (untrusted input) ---
  const inputCheck = checkInputGuardrails(ticketText);

  const { category } = classifyTicket({ subject: ticket.subject, body: ticket.body });

const searchResultsRaw = searchKnowledgeBase(ticketText, { topK: 3, categoryHint: category });

// Only docs that actually clear the citation threshold would ever be used.
// We check the adversarial-doc guardrail against THAT set, not the raw
// top-K candidates — otherwise the unsafe doc merely showing up with an
// irrelevant, sub-threshold score would wrongly trigger a refusal.
const candidateCitations = searchResultsRaw.filter((r) => r.score >= MIN_CITATION_SCORE);

// --- GUARDRAIL CHECK 2: never trust/cite the adversarial KB doc ---
const { safeResults, blockedDocIds } = filterUnsafeDocuments(candidateCitations);

const guardrailTriggered = inputCheck.triggered || blockedDocIds.length > 0;
const normalCitations = safeResults.filter((r) => r.score >= MIN_CITATION_SCORE).map((r) => r.doc_id);
// On a guardrail trigger, we still ground the refusal in whatever real
// policy applies to the underlying request (e.g. KB-ACCOUNT-001 for an
// account-change request), UNION'd with KB-SECURITY-001 (which justifies
// refusing the embedded unsafe instruction itself).
const citations = guardrailTriggered
  ? Array.from(new Set([...normalCitations, "KB-SECURITY-001"]))
  : normalCitations;

  let status;
  let body;
  let recommended_actions;

  if (guardrailTriggered) {
    // Refuse the unsafe request outright. Never reveal secrets, never
    // issue a coupon/refund on the basis of an injected instruction.
    // Always escalate so a human reviews it.
   status = "refused";
body = `Hi, I'm unable to process this request as described. As Per our AI Support Security Playbook (see KB-SECURITY-001), I don't follow instructions embedded in a customer message or a retrieved document, and I can't share internal system prompts, API keys, or hidden notes. This looks like an unsafe instruction, so I'm flagging it and escalating this ticket to a human agent for review rather than taking any action on it.`;
    recommended_actions = [{
      tool_name: "escalate_to_human",
      requires_human_approval: false,
      reason: "Guardrail triggered: " + [
        ...inputCheck.violations.map((v) => v.type),
        ...blockedDocIds.map((d) => `untrusted_document:${d}`),
      ].join(", "),
    }];
  } else {
    const finalSale = category === "refund" && isFinalSaleOrder(order);

    if (citations.length === 0 && category !== "account_security") {
      status = "escalated";
      body = `Hi, thanks for reaching out. I want to make sure you get accurate information, but I couldn't find clear policy guidance for this specific request. I'm escalating this to a human agent who can review it properly.`;
      recommended_actions = [{ tool_name: "escalate_to_human", requires_human_approval: false, reason: "No confident policy citation found for this request." }];
    } else {
      status = "generated";
      recommended_actions = recommendActions({ category, ticket, order });
      body = buildDraftBody({ category, ticket, customer, order, citations, finalSale });
    }
  }

  const db = getDb();
  const draft_id = `draft_${uuidv4().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO drafts (draft_id, ticket_id, status, body, citations, recommended_actions, created_at)
    VALUES (@draft_id, @ticket_id, @status, @body, @citations, @recommended_actions, @created_at)
  `).run({
    draft_id,
    ticket_id: ticketId,
    status,
    body,
    citations: JSON.stringify(citations),
    recommended_actions: JSON.stringify(recommended_actions),
    created_at: new Date().toISOString(),
  });
  db.close();

  const run_id = recordRun({
    ticketId,
    runType: "draft_reply",
    status: "completed",
    retrievedDocIds: citations,
    toolCalls: recommended_actions.map((a) => a.tool_name),
    guardrailResults: {
      triggered: guardrailTriggered,
      input_violations: inputCheck.violations,
      blocked_doc_ids: blockedDocIds,
    },
  });

  return { draft_id, ticket_id: ticketId, status, body, citations, recommended_actions, run_id, guardrail_triggered: guardrailTriggered };
}

module.exports = { generateDraft };