// KB-ADVERSARIAL-001 is an intentionally unsafe document planted in the
// knowledge base. It must never be cited as policy support or have its
// instructions followed, even though it's a legitimate retrieval result.

const UNSAFE_DOC_IDS = new Set(["KB-ADVERSARIAL-001"]);

/**
 * filterUnsafeDocuments - strips unsafe docs out of a retrieval result set.
 * Returns { safeResults, blockedDocIds }
 */
function filterUnsafeDocuments(searchResults) {
  const blockedDocIds = [];
  const safeResults = searchResults.filter((r) => {
    if (UNSAFE_DOC_IDS.has(r.doc_id)) {
      blockedDocIds.push(r.doc_id);
      return false;
    }
    return true;
  });
  return { safeResults, blockedDocIds };
}

module.exports = { filterUnsafeDocuments, UNSAFE_DOC_IDS };