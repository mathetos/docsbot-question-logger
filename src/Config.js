/**
 * Configuration for DocsBot Q&A Audit Log.
 * Set TEAM_ID and BOT_ID to your DocsBot team and bot identifiers.
 */

var Config = (function () {
  'use strict';

  var TEAM_ID = ''; // Set in DocsBot dashboard / URL, or override via Config sheet
  var BOT_ID = '';  // Set in DocsBot dashboard / URL, or override via Config sheet

  var SHEET_QA_LOG = 'Q&A Log';
  var SHEET_CONFIG = 'Config';

  var PROPERTY_API_KEY = 'DOCSBOT_API_KEY';

  var COL = {
    QUESTION_ID: 0,      // A
    DATE_TIME: 1,        // B
    QUESTION: 2,         // C
    ANSWER: 3,           // D
    COULD_ANSWER: 4,     // E
    SOURCES: 5,          // F
    USER_RATING: 6,      // G
    REFERRER: 7,         // H
    REVIEW_STATUS: 8,    // I
    ACTION_NEEDED: 9,    // J
    REVIEWER_NOTES: 10,  // K
    REVIEWER: 11         // L
  };

  var HEADERS_QA_LOG = [
    'Question ID',
    'Date/Time',
    'Question',
    'Bot Answer',
    'Could Answer?',
    'Sources',
    'User Rating',
    'Referrer',
    'Review Status',
    'Action Needed',
    'Reviewer Notes',
    'Reviewer'
  ];

  var REVIEW_STATUS_VALUES = ['Pending Review', 'Reviewed'];

  var ACTION_NEEDED_VALUES = [
    'Good response (no action needed)',
    'Needs Improvement in Docs',
    'Needs Improvement in Bot sources',
    'Needs Improvement in Custom Instructions'
  ];

  var CONFIG_LAST_SYNCED_AT = 'lastSyncedAt';
  var CONFIG_LAST_RUN_AT = 'lastRunAt';
  var CONFIG_TEAM_ID = 'teamId';
  var CONFIG_BOT_ID = 'botId';

  var DOCSBOT_API_BASE = 'https://docsbot.ai/api';
  var PER_PAGE = 100;

  var DAILY_TRIGGER_HOUR = 6; // 6 AM in script timezone

  // Google Sheets cell limit is 50,000 characters; stay under to allow " [truncated]" suffix
  var MAX_CELL_CHARS = 49900;

  // API retry: exponential backoff for 429 / 5xx
  var MAX_RETRIES = 3;
  var RETRY_BASE_MS = 1000; // 1s, 2s, 4s

  // GAS has a 6-minute hard limit; stop fetching at 5 minutes to leave time for flush
  var SYNC_TIME_BUDGET_MS = 300000;

  // PII: truncate input before regex to avoid catastrophic backtracking on huge strings
  var PII_SCRUB_MAX_LENGTH = 15000;

  return {
    getTeamId: function () { return TEAM_ID; },
    getBotId: function () { return BOT_ID; },
    setTeamId: function (id) { TEAM_ID = id; },
    setBotId: function (id) { BOT_ID = id; },
    getSheetQALogName: function () { return SHEET_QA_LOG; },
    getSheetConfigName: function () { return SHEET_CONFIG; },
    getApiKeyPropertyName: function () { return PROPERTY_API_KEY; },
    getCol: function () { return COL; },
    getHeadersQALog: function () { return HEADERS_QA_LOG; },
    getReviewStatusValues: function () { return REVIEW_STATUS_VALUES; },
    getActionNeededValues: function () { return ACTION_NEEDED_VALUES; },
    getConfigKeys: function () {
      return {
        lastSyncedAt: CONFIG_LAST_SYNCED_AT,
        lastRunAt: CONFIG_LAST_RUN_AT,
        teamId: CONFIG_TEAM_ID,
        botId: CONFIG_BOT_ID
      };
    },
    getDocsBotApiBase: function () { return DOCSBOT_API_BASE; },
    getPerPage: function () { return PER_PAGE; },
    getDailyTriggerHour: function () { return DAILY_TRIGGER_HOUR; },
    getMaxCellChars: function () { return MAX_CELL_CHARS; },
    getMaxRetries: function () { return MAX_RETRIES; },
    getRetryBaseMs: function () { return RETRY_BASE_MS; },
    getSyncTimeBudgetMs: function () { return SYNC_TIME_BUDGET_MS; },
    getPiiScrubMaxLength: function () { return PII_SCRUB_MAX_LENGTH; }
  };
})();
