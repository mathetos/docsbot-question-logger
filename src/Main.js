/**
 * Entry points: onOpen menu, Sync Now, Setup API Key, createDailyTrigger.
 * Orchestrates DocsBot API fetch, PII scrubbing, and sheet write.
 */

/**
 * Runs when the spreadsheet is opened. Adds custom menu.
 */
function onOpen() {
  'use strict';
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('DocsBot Audit')
    .addItem('Sync Now', 'menuSyncNow')
    .addItem('Setup API Key', 'menuSetupApiKey')
    .addToUi();
}

/**
 * Menu action: run sync directly and show result via alert.
 */
function menuSyncNow() {
  'use strict';
  var ui = SpreadsheetApp.getUi();
  try {
    var result = syncQuestions();
    var msg = result.added === 0
      ? 'No new questions. Your log is up to date.'
      : 'Added ' + result.added + ' new question' + (result.added === 1 ? '' : 's') + ' to the Q&A log.';
    ui.alert('Sync complete', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Sync failed', e.message || String(e), ui.ButtonSet.OK);
  }
}

/**
 * Menu action: prompt for API key and save to Script Properties.
 */
function menuSetupApiKey() {
  'use strict';
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('DocsBot API Key', 'Enter your DocsBot API Bearer token (it will be stored in Script Properties):', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var key = (response.getResponseText() || '').trim();
  if (!key) {
    ui.alert('No key entered.');
    return;
  }
  setupApiKey(key);
  ui.alert('API key saved. You can run Sync Now.');
}

/**
 * Saves the DocsBot API key to Script Properties.
 * @param {string} apiKey
 */
function setupApiKey(apiKey) {
  'use strict';
  var props = PropertiesService.getScriptProperties();
  props.setProperty(Config.getApiKeyPropertyName(), apiKey);
}

/**
 * Syncs DocsBot Q&A history to the Q&A Log sheet.
 * Reads teamId/botId from Config sheet (or Config defaults), lastSyncedAt from Config sheet.
 * Fetches questions, scrubs PII, appends new rows, updates lastSyncedAt and lastRunAt.
 * @returns {{ added: number }}
 */
function syncQuestions() {
  'use strict';

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var apiKey = PropertiesService.getScriptProperties().getProperty(Config.getApiKeyPropertyName());
  if (!apiKey) {
    throw new Error('API key not set. Use DocsBot Audit > Setup API Key.');
  }

  var teamId = SheetWriter.getConfigValue(ss, Config.getConfigKeys().teamId) || Config.getTeamId();
  var botId = SheetWriter.getConfigValue(ss, Config.getConfigKeys().botId) || Config.getBotId();
  if (!teamId || !botId) {
    throw new Error('Team ID and Bot ID must be set in the Config sheet (Key: teamId, botId) or in Config.js.');
  }

  // Fast path: if sheet already has data, compare newest ID from API with newest in sheet
  var sheetLatestId = SheetWriter.getLatestQuestionId(ss);
  if (sheetLatestId) {
    var apiLatest = fetchLatestQuestion(apiKey, teamId, botId);
    if (apiLatest && apiLatest.id && apiLatest.id === sheetLatestId) {
      return { added: 0 };
    }
  }

  var lastSyncedAt = SheetWriter.getConfigValue(ss, Config.getConfigKeys().lastSyncedAt);
  var sinceIso = lastSyncedAt || null;

  var existingIds = SheetWriter.getExistingQuestionIds(ss);
  var questions = fetchAllQuestions(apiKey, teamId, botId, sinceIso);

  var rows = [];
  var latestCreatedAt = null;

  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    if (existingIds[q.id]) continue;

    var questionScrubbed = PiiScrubber.scrub(q.question || '');
    var answerScrubbed = PiiScrubber.scrub(q.answer || '');
    rows.push(SheetWriter.buildRow(q, questionScrubbed, answerScrubbed));

    var t = q.createdAt ? new Date(q.createdAt).getTime() : 0;
    if (t && (latestCreatedAt === null || t > latestCreatedAt)) {
      latestCreatedAt = q.createdAt;
    }
  }

  SheetWriter.appendRows(ss, rows);
  SheetWriter.sortQALogByNewestFirst(ss);

  var now = new Date().toISOString();
  SheetWriter.setConfigValue(ss, Config.getConfigKeys().lastRunAt, now);
  if (latestCreatedAt) {
    SheetWriter.setConfigValue(ss, Config.getConfigKeys().lastSyncedAt, latestCreatedAt);
  }

  return { added: rows.length };
}

/**
 * Creates a daily time-driven trigger to run syncQuestions once per day.
 * Run this once from the Apps Script editor (Run > createDailyTrigger).
 */
function createDailyTrigger() {
  'use strict';

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncQuestions') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('syncQuestions')
    .timeBased()
    .everyDays(1)
    .atHour(Config.getDailyTriggerHour())
    .create();
}
