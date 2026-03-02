/**
 * PII scrubbing – "Scrub-First" pipeline.
 *
 * Single-pass combined regex for email, phone, SSN, credit card, and IPv4.
 * Length cap prevents catastrophic backtracking on very long strings.
 * Timing instrumentation logs slow scrubs for performance monitoring.
 */

var PiiScrubber = (function () {
  'use strict';

  var TAG_SSN   = '[SSN_REDACTED]';
  var TAG_CC    = '[CC_REDACTED]';
  var TAG_EMAIL = '[EMAIL_REDACTED]';
  var TAG_PHONE = '[PHONE_REDACTED]';
  var TAG_IP    = '[IP_REDACTED]';

  // -----------------------------------------------------------------------
  // Pattern sources — no internal capturing groups so the combined regex
  // has exactly one capturing group per alternative, making the replacer
  // trivial to index.  Non-greedy / bounded quantifiers throughout.
  //
  // Priority order: SSN → CC → Email → Phone → IP
  //   SSN before Phone because 123-45-6789 looks phone-like.
  //   CC before Phone because 16-digit groups look phone-like.
  //   Email uses the @ anchor so it's unambiguous.
  //   IP last as the least likely PII pattern in chat text.
  // -----------------------------------------------------------------------

  var P_SSN   = '\\b\\d{3}-\\d{2}-\\d{4}\\b';
  var P_CC    = '\\b(?:\\d{4}[\\s-]?){3}\\d{4}\\b';
  var P_EMAIL = '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}';
  var P_PHONE = '(?:\\+?\\d{1,3}[\\-.\\s]?)?\\(?\\d{3}\\)?[\\-.\\s]?\\d{3}[\\-.\\s]?\\d{4}(?:[\\-.\\s]?x?\\d{1,6})?';
  var P_IP    = '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b';

  // Groups:  1=SSN  2=CC  3=Email  4=Phone  5=IP
  var RE_COMBINED = new RegExp(
    '(' + P_SSN + ')'
    + '|(' + P_CC + ')'
    + '|(' + P_EMAIL + ')'
    + '|(' + P_PHONE + ')'
    + '|(' + P_IP + ')',
    'g'
  );

  var TAGS = [null, TAG_SSN, TAG_CC, TAG_EMAIL, TAG_PHONE, TAG_IP];

  /**
   * Replacer for single-pass regex. Checks which capturing group matched.
   */
  function replacer(match, g1, g2, g3, g4, g5) {
    if (g1 !== undefined) return TAGS[1];
    if (g2 !== undefined) return TAGS[2];
    if (g3 !== undefined) return TAGS[3];
    if (g4 !== undefined) return TAGS[4];
    if (g5 !== undefined) return TAGS[5];
    return match;
  }

  /**
   * Scrubs PII from a single string.
   * Applies a length cap before the regex pass to prevent backtracking
   * on very long inputs (cap defaults to 15 000 chars via Config).
   *
   * @param {string} text
   * @returns {string}
   */
  function scrub(text) {
    if (typeof text !== 'string' || text.length === 0) return text;

    var maxLen = Config.getPiiScrubMaxLength();
    var input = text;
    if (input.length > maxLen) {
      input = input.substring(0, maxLen) + ' [TRUNCATED_FOR_PII_SCAN]';
    }

    RE_COMBINED.lastIndex = 0;
    return input.replace(RE_COMBINED, replacer);
  }

  /**
   * Scrubs all PII-sensitive fields on a DocsBot question object **in place**.
   * Called immediately after the API response is parsed so that raw PII
   * never travels further into the pipeline.
   *
   * @param {Object} q - Mutable question object from API
   * @returns {Object} Same object, mutated
   */
  function scrubQuestion(q) {
    var t0 = Date.now();

    if (q.question) q.question = scrub(q.question);
    if (q.answer)   q.answer   = scrub(q.answer);

    if (q.metadata) {
      if (q.metadata.referrer)  q.metadata.referrer  = scrub(q.metadata.referrer);
      if (q.metadata.email)     q.metadata.email     = scrub(q.metadata.email);
      if (q.metadata.ip)        q.metadata.ip        = scrub(q.metadata.ip);
      if (q.metadata.userAgent) q.metadata.userAgent = scrub(q.metadata.userAgent);
    }

    var elapsed = Date.now() - t0;
    if (elapsed > 200) {
      Logger.log('[pii] WARNING: scrubQuestion took %sms for q.id=%s', elapsed, q.id);
    }

    return q;
  }

  /**
   * Batch-scrubs an array of question objects in place.
   * Logs aggregate timing for the full batch.
   *
   * @param {Array.<Object>} questions
   * @returns {Array.<Object>} Same array, mutated
   */
  function scrubAll(questions) {
    if (!questions || questions.length === 0) return questions;

    var t0 = Date.now();
    for (var i = 0; i < questions.length; i++) {
      scrubQuestion(questions[i]);
    }
    var elapsed = Date.now() - t0;
    Logger.log('[pii] Scrubbed %s question(s) in %sms', questions.length, elapsed);

    return questions;
  }

  return {
    scrub: scrub,
    scrubQuestion: scrubQuestion,
    scrubAll: scrubAll
  };
})();
