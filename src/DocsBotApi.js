/**
 * DocsBot Admin API client.
 *
 * Resilience:
 *   - fetchWithRetry: exponential backoff on 429 / 5xx, strict status + JSON validation.
 *   - fetchQuestionPage: single-page fetch with retry, returns { questions, hasMorePages }.
 *   - fetchLatestQuestion: one lightweight call for the fast-path check.
 *   - fetchAllQuestions: descending (newest-first) fetch with early-exit on known IDs
 *     and time-budget guard.
 *
 * Privacy:
 *   - fetchAllQuestions scrubs PII via PiiScrubber.scrubAll() before returning data.
 *     No raw PII leaves this layer — downstream code (Main, SheetWriter) only sees redacted text.
 */

// ---------------------------------------------------------------------------
// Retry wrapper
// ---------------------------------------------------------------------------

/**
 * Fetches a URL with automatic retries on transient errors (429 and 5xx).
 * Uses exponential backoff: 1s, 2s, 4s (configurable via Config).
 *
 * @param {string} url - Full URL to fetch
 * @param {Object} options - UrlFetchApp options (must include muteHttpExceptions: true)
 * @param {string} label - Human-readable label for log messages (e.g. "page 3")
 * @returns {HTTPResponse}
 * @throws {Error} After all retries exhausted, or on non-retryable errors (4xx except 429)
 */
function fetchWithRetry(url, options, label) {
  'use strict';

  var maxRetries = Config.getMaxRetries();
  var baseMs = Config.getRetryBaseMs();
  var lastError = null;

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      var delayMs = baseMs * Math.pow(2, attempt - 1);
      Logger.log('[api] Retry %s/%s for %s — waiting %sms', attempt, maxRetries, label, delayMs);
      Utilities.sleep(delayMs);
    }

    var response;
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (e) {
      lastError = new Error('[api] Network error on ' + label + ': ' + (e.message || String(e)));
      Logger.log(lastError.message);
      continue;
    }

    var code = response.getResponseCode();

    if (code === 200) return response;

    var bodySnippet = (response.getContentText() || '').substring(0, 300);

    if (code === 429 || code >= 500) {
      lastError = new Error('[api] HTTP ' + code + ' on ' + label + ': ' + bodySnippet);
      Logger.log(lastError.message);
      continue;
    }

    // Non-retryable client error (401, 403, 404, etc.)
    throw new Error(
      'DocsBot API error (HTTP ' + code + ') on ' + label + ': ' + bodySnippet
    );
  }

  throw lastError || new Error('[api] All retries exhausted for ' + label);
}

/**
 * Parses a JSON response body with validation.
 * @param {HTTPResponse} response
 * @param {string} label - For error messages
 * @returns {Object}
 */
function parseJsonResponse(response, label) {
  'use strict';
  var text = response.getContentText();
  if (!text || text.trim().length === 0) {
    throw new Error('[api] Empty response body on ' + label);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      '[api] Invalid JSON on ' + label + ': ' + text.substring(0, 200)
    );
  }
}

// ---------------------------------------------------------------------------
// Single-page fetch
// ---------------------------------------------------------------------------

/**
 * Fetches one page of questions from the DocsBot API.
 * @param {string} apiKey
 * @param {string} teamId
 * @param {string} botId
 * @param {number} page - Zero-based page index
 * @param {number} perPage
 * @param {boolean} ascending
 * @returns {{ questions: Array.<Object>, hasMorePages: boolean }}
 */
function fetchQuestionPage(apiKey, teamId, botId, page, perPage, ascending) {
  'use strict';

  var baseUrl = Config.getDocsBotApiBase();
  var url = baseUrl + '/teams/' + encodeURIComponent(teamId)
          + '/bots/' + encodeURIComponent(botId) + '/questions';
  var asc = ascending ? 'true' : 'false';
  var query = '?ascending=' + asc + '&page=' + page + '&perPage=' + perPage;
  var label = 'questions page ' + page;

  var options = {
    method: 'get',
    headers: { Authorization: 'Bearer ' + apiKey },
    muteHttpExceptions: true
  };

  var response = fetchWithRetry(url + query, options, label);
  var body = parseJsonResponse(response, label);

  return {
    questions: body.questions || [],
    hasMorePages: (body.pagination && body.pagination.hasMorePages === true)
  };
}

// ---------------------------------------------------------------------------
// Fast-path: latest question
// ---------------------------------------------------------------------------

/**
 * Fetches only the most recent non-deleted question (one API call).
 * Used for the fast "no new data" check.
 * @param {string} apiKey
 * @param {string} teamId
 * @param {string} botId
 * @returns {{ id: string, createdAt: string }|null}
 */
function fetchLatestQuestion(apiKey, teamId, botId) {
  'use strict';

  if (!apiKey || !teamId || !botId) return null;

  try {
    var result = fetchQuestionPage(apiKey, teamId, botId, 0, 1, false);
    var q = result.questions[0];
    if (!q || q.deleted) return null;
    return { id: q.id || '', createdAt: q.createdAt || '' };
  } catch (e) {
    Logger.log('[api] fetchLatestQuestion failed (non-fatal): %s', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Full paginated fetch — newest-first with early exit
// ---------------------------------------------------------------------------

/**
 * Fetches new questions using descending order (newest-first) with early exit.
 *
 * Strategy: pages arrive newest-first. Within each page, any question whose
 * ID exists in existingIds is skipped.  After processing a complete page, if
 * at least one known ID was found, pagination stops — all subsequent pages
 * are older and therefore already in the sheet.
 *
 * Stops early if:
 *   - A known question ID is found (finish current page, then stop).
 *   - No more pages from the API.
 *   - The time budget is about to expire.
 *
 * @param {string} apiKey
 * @param {string} teamId
 * @param {string} botId
 * @param {Object.<string, boolean>} existingIds - Question IDs already in the sheet
 * @param {number} startMs - Date.now() when the sync started
 * @returns {{ questions: Array.<Object>, timedOut: boolean }}
 */
function fetchAllQuestions(apiKey, teamId, botId, existingIds, startMs) {
  'use strict';

  if (!apiKey || !teamId || !botId) {
    throw new Error('DocsBot API: apiKey, teamId, and botId are required.');
  }

  var perPage = Config.getPerPage();
  var budget = Config.getSyncTimeBudgetMs();
  var allQuestions = [];
  var page = 0;
  var hasMore = true;
  var timedOut = false;

  while (hasMore) {
    var elapsed = Date.now() - startMs;
    if (elapsed >= budget) {
      Logger.log(
        '[api] Time limit approaching (%sms / %sms). Stopping gracefully after %s page(s), %s question(s) collected.',
        elapsed, budget, page, allQuestions.length
      );
      timedOut = true;
      break;
    }

    var result = fetchQuestionPage(apiKey, teamId, botId, page, perPage, false);
    var questions = result.questions;
    var hitKnown = false;

    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (q.deleted) continue;
      if (existingIds && existingIds[q.id]) {
        hitKnown = true;
        continue;
      }
      allQuestions.push(q);
    }

    page++;

    if (hitKnown) {
      Logger.log('[api] Hit known ID on page %s — stopping pagination', page - 1);
      break;
    }

    hasMore = result.hasMorePages;
  }

  Logger.log('[api] Fetched %s page(s), %s new question(s)', page, allQuestions.length);

  // Scrub PII immediately so raw data never leaves this layer
  PiiScrubber.scrubAll(allQuestions);

  return { questions: allQuestions, timedOut: timedOut };
}
