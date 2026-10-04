const { getDb } = require("../db/connection");

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","to","of","in","on","for",
  "and","or","but","if","my","i","you","your","it","this","that","can","could","would",
  "will","with","has","have","had","do","does","did","not","no","please","hi","hello",
  "am","me","we","us","our","as","at","by","from","up","so","what","how","when",
]);

// Maps a triage category to the doc_id prefix that should be boosted during
// retrieval. This lets classification inform retrieval, which is more
// reliable than pure keyword overlap alone (tickets rarely use the exact
// vocabulary of the policy doc — e.g. "cracked" vs. the doc's "damaged").
const CATEGORY_DOC_PREFIX = {
  refund: "KB-REFUND",
  warranty: "KB-WARRANTY",
  shipping: "KB-SHIPPING",
  billing: "KB-BILLING",
  account_security: "KB-ACCOUNT",
};
const CATEGORY_BOOST = 3;

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function getAllDocuments() {
  const db = getDb();
  const docs = db.prepare(`SELECT doc_id, title, content, source_path FROM knowledge_documents`).all();
  db.close();
  return docs;
}

/**
 * searchKnowledgeBase - keyword + category-biased retrieval.
 * @param {string} query - raw ticket text (subject + body)
 * @param {object} opts
 * @param {number} opts.topK
 * @param {string} [opts.categoryHint] - triage category, used to boost the matching policy doc
 */
function searchKnowledgeBase(query, { topK = 3, categoryHint = null } = {}) {
  const queryTokens = tokenize(query);
  const queryTermSet = new Set(queryTokens); // dedupe for scoring AND normalization
  if (queryTermSet.size === 0) return [];

  const docs = getAllDocuments();
  const boostPrefix = categoryHint ? CATEGORY_DOC_PREFIX[categoryHint] : null;

  const scored = docs.map((doc) => {
    const titleSet = new Set(tokenize(doc.title));
    const bodySet = new Set(tokenize(doc.content));

    let score = 0;
    const matchedTerms = [];
    for (const term of queryTermSet) {
      if (titleSet.has(term)) {
        score += 2;
        matchedTerms.push(term);
      } else if (bodySet.has(term)) {
        score += 1;
        matchedTerms.push(term);
      }
    }

    // Category boost: if triage already told us this is a "refund" ticket,
    // the refund policy doc should win over incidental word overlaps elsewhere.
    let boosted = false;
    if (boostPrefix && doc.doc_id.startsWith(boostPrefix)) {
      score += CATEGORY_BOOST;
      boosted = true;
    }

    // Normalize by the number of UNIQUE query terms (not raw token count,
    // which double-counts repeated words and dilutes the score unfairly).
    const normalizedScore = score / (queryTermSet.size * 2 + CATEGORY_BOOST);

    let snippet = doc.content.slice(0, 160).replace(/\s+/g, " ").trim();
    if (matchedTerms.length > 0) {
      const idx = doc.content.toLowerCase().indexOf(matchedTerms[0]);
      if (idx > -1) {
        const start = Math.max(0, idx - 60);
        snippet = doc.content.slice(start, start + 180).replace(/\s+/g, " ").trim();
      }
    }

    return {
      doc_id: doc.doc_id,
      title: doc.title,
      snippet,
      score: Number(normalizedScore.toFixed(3)),
      matchedTerms,
      boosted,
    };
  });

  return scored
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function getDocumentById(docId) {
  const db = getDb();
  const doc = db.prepare(`SELECT * FROM knowledge_documents WHERE doc_id = ?`).get(docId);
  db.close();
  return doc || null;
}

module.exports = { searchKnowledgeBase, getDocumentById, tokenize };