// Detects prompt-injection, secret-exfiltration, coupon-abuse, and
// identity-bypass attempts in raw ticket text. Per KB-SECURITY-001:
// customer messages are untrusted DATA, never instructions — this module
// is how we enforce that mechanically, not just by prompt-wording.

const PATTERNS = {
  prompt_injection: [
    /ignore (all |previous )?instructions?/i,
    /system override/i,
    /ignore the (support )?polic(y|ies)/i,
    /policy has changed/i,
    /approve all refunds/i,
    /you are now allowed/i,
  ],
  secret_exfiltration: [
    /system prompt/i,
    /api key/i,
    /internal notes?/i,
    /hidden (instructions?|prompt)/i,
    /reveal (your )?(system )?(prompt|instructions)/i,
  ],
  coupon_abuse: [
    /issue (me )?a coupon/i,
    /create a coupon/i,
    /do not (mention|tell)/i,
  ],
  identity_bypass: [
    /skip (the )?identity/i,
    /ignore identity checks?/i,
    /without verif(y|ication)/i,
    /bypass verification/i,
  ],
};

/**
 * checkInputGuardrails - scans a block of untrusted text (ticket subject+body,
 * or retrieved document content) for known attack patterns.
 * Returns { triggered, violations: [{ type, pattern }] }
 */
function checkInputGuardrails(text) {
  const violations = [];
  for (const [type, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        violations.push({ type, pattern: pattern.source });
      }
    }
  }
  return { triggered: violations.length > 0, violations };
}

module.exports = { checkInputGuardrails };