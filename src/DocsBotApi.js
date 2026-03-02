/**
 * DocsBot Admin API client for Q&A history.
 * Fetches questions with pagination; API key from Script Properties.
 */

/**
 * Fetches only the most recent question (one API call). Used for fast "no new data" check.
 * @param {string} apiKey - Bearer token for DocsBot API
 * @param {string} teamId - DocsBot team ID
 * @param {string} botId - DocsBot bot ID
 * @returns {{ id: string, createdAt: string }|null} Latest question or null if none/deleted
 */
function fetchLatestQuestion(apiKey, teamId, botId) {
  'use strict';

  if (!apiKey || !teamId || !botId) return null;

  var baseUrl = Config.getDocsBotApiBase();
  var url = baseUrl + '/teams/' + encodeURIComponent(teamId) + '/bots/' + encodeURIComponent(botId) + '/questions';
  var query = '?ascending=false&page=0&perPage=1';
  var options = {
    method: 'get',
    headers: { Authorization: 'Bearer ' + apiKey },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url + query, options);
  if (response.getResponseCode() !== 200) return null;

  var body = JSON.parse(response.getContentText());
  var questions = body.questions || [];
  var q = questions[0];
  if (!q || q.deleted) return null;

  return { id: q.id || '', createdAt: q.createdAt || '' };
}

/**
 * Fetches all questions from DocsBot API (paginated).
 * Filters out deleted questions.
 * @param {string} apiKey - Bearer token for DocsBot API
 * @param {string} teamId - DocsBot team ID
 * @param {string} botId - DocsBot bot ID
 * @param {string} sinceIso - Optional. Only return questions created after this ISO timestamp (exclusive).
 * @returns {Array.<Object>} Array of question objects (non-deleted)
 */
function fetchAllQuestions(apiKey, teamId, botId, sinceIso) {
  'use strict';

  if (!apiKey || !teamId || !botId) {
    throw new Error('DocsBot API: apiKey, teamId, and botId are required.');
  }

  var baseUrl = Config.getDocsBotApiBase();
  var perPage = Config.getPerPage();
  var url = baseUrl + '/teams/' + encodeURIComponent(teamId) + '/bots/' + encodeURIComponent(botId) + '/questions';
  var allQuestions = [];
  var page = 0;
  var hasMore = true;
  var cutoffTime = sinceIso ? new Date(sinceIso).getTime() : 0;

  while (hasMore) {
    var query = '?ascending=true&page=' + page + '&perPage=' + perPage;
    var options = {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + apiKey
      },
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url + query, options);
    var code = response.getResponseCode();

    if (code !== 200) {
      throw new Error('DocsBot API error: ' + code + ' ' + response.getContentText());
    }

    var body = JSON.parse(response.getContentText());
    var questions = body.questions || [];
    var pagination = body.pagination || {};

    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (q.deleted) continue;
      var createdAt = q.createdAt ? new Date(q.createdAt).getTime() : 0;
      if (createdAt <= cutoffTime) continue;
      allQuestions.push(q);
    }

    hasMore = pagination.hasMorePages === true;
    page += 1;
  }

  return allQuestions;
}
