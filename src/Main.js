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
  ui.createMenu('🤖 DocsBot Audit')
    .addItem('Sync Now', 'menuSyncNow')
    .addSeparator()
    .addItem('Setup API Key', 'menuSetupApiKey')
    .addItem('Setup Team ID & Bot ID', 'menuSetupIds')
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
    var msg;
    if (result.added === 0) {
      msg = 'No new questions. Your log is up to date.';
    } else {
      msg = 'Added ' + result.added + ' new question' + (result.added === 1 ? '' : 's') + ' to the Q&A log.';
    }
    if (result.timedOut) {
      msg += '\n\nNote: Sync stopped early due to time limit. Run Sync Now again to continue.';
    }
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
 * Menu action: prompt for Team ID and Bot ID and save to the Config sheet.
 */
function menuSetupIds() {
  'use strict';
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var keys = Config.getConfigKeys();

  var currentTeamId = SheetWriter.getConfigValue(ss, keys.teamId);
  var currentBotId = SheetWriter.getConfigValue(ss, keys.botId);

  var teamResponse = ui.prompt(
    'DocsBot Team ID',
    'Enter your DocsBot Team ID (from the dashboard URL).' + (currentTeamId ? '\n\nCurrent: ' + currentTeamId : ''),
    ui.ButtonSet.OK_CANCEL
  );
  if (teamResponse.getSelectedButton() !== ui.Button.OK) return;
  var teamId = (teamResponse.getResponseText() || '').trim();
  if (!teamId) {
    ui.alert('No Team ID entered.');
    return;
  }

  var botResponse = ui.prompt(
    'DocsBot Bot ID',
    'Enter your DocsBot Bot ID (from the dashboard URL).' + (currentBotId ? '\n\nCurrent: ' + currentBotId : ''),
    ui.ButtonSet.OK_CANCEL
  );
  if (botResponse.getSelectedButton() !== ui.Button.OK) return;
  var botId = (botResponse.getResponseText() || '').trim();
  if (!botId) {
    ui.alert('No Bot ID entered.');
    return;
  }

  SheetWriter.loadConfigCache(ss);
  SheetWriter.setConfigValue(ss, keys.teamId, teamId);
  SheetWriter.setConfigValue(ss, keys.botId, botId);
  SheetWriter.flushConfigCache(ss);
  SheetWriter.resetConfigCache();
  ui.alert('Configuration saved', 'Team ID and Bot ID have been saved to the Config sheet.', ui.ButtonSet.OK);
}

/**
 * Syncs DocsBot Q&A history to the Q&A Log sheet.
 *
 * Pipeline:
 *   1. Fast-path check (1 API call) — if the latest IDs match, return immediately.
 *   2. Descending fetch — newest-first pages, stops as soon as a known ID is hit.
 *   3. PII scrubbed at the API layer before data reaches this function.
 *   4. Insert-at-top — new rows go directly after the header, no sort needed.
 *   5. Watermark updated only after successful write (idempotent).
 *
 * @returns {{ added: number, timedOut: boolean }}
 */
function syncQuestions() {
  'use strict';

  var startMs = Date.now();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var apiKey = PropertiesService.getScriptProperties().getProperty(Config.getApiKeyPropertyName());
  if (!apiKey) {
    throw new Error('API key not set. Use DocsBot Audit > Setup API Key.');
  }

  SheetWriter.loadConfigCache(ss);

  var keys = Config.getConfigKeys();
  var teamId = SheetWriter.getConfigValue(ss, keys.teamId) || Config.getTeamId();
  var botId = SheetWriter.getConfigValue(ss, keys.botId) || Config.getBotId();
  if (!teamId || !botId) {
    throw new Error('Team ID and Bot ID must be set in the Config sheet (Key: teamId, botId) or in Config.js.');
  }

  // ---- Fast path ----
  var sheetLatestId = SheetWriter.getLatestQuestionId(ss);
  Logger.log('[sync] Sheet latest ID: %s', sheetLatestId || '(empty)');

  if (sheetLatestId) {
    var apiLatest = fetchLatestQuestion(apiKey, teamId, botId);
    Logger.log('[sync] API latest ID: %s', apiLatest ? apiLatest.id : '(null)');
    if (apiLatest && apiLatest.id && apiLatest.id === sheetLatestId) {
      Logger.log('[sync] Fast path: IDs match, nothing to do (%sms)', Date.now() - startMs);
      return { added: 0 };
    }
    Logger.log('[sync] Fast path: IDs differ, proceeding to fetch');
  }

  // ---- Fetch from API (descending, early-exit on known ID) ----
  var existingIds = SheetWriter.getExistingQuestionIds(ss);
  Logger.log('[sync] Existing IDs in sheet: %s', Object.keys(existingIds).length);

  var fetchResult = fetchAllQuestions(apiKey, teamId, botId, existingIds, startMs);
  var questions = fetchResult.questions;
  var timedOut = fetchResult.timedOut;

  Logger.log('[sync] API returned %s new question(s), timedOut=%s', questions.length, timedOut);

  // ---- Build rows (safety-net dedup; API layer already filters known IDs) ----
  var rows = [];
  var skippedDupes = 0;
  var latestCreatedAt = null;

  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    if (existingIds[q.id]) {
      skippedDupes++;
      continue;
    }

    rows.push(SheetWriter.buildRow(q, q.question || '', q.answer || ''));

    var t = q.createdAt ? new Date(q.createdAt).getTime() : 0;
    if (t && (latestCreatedAt === null || t > latestCreatedAt)) {
      latestCreatedAt = q.createdAt;
    }
  }

  Logger.log('[sync] New rows to write: %s, safety-net dupes skipped: %s', rows.length, skippedDupes);

  // ---- Write to sheet (insert-at-top keeps newest-first, no sort needed) ----
  SheetWriter.appendRows(ss, rows);
  Logger.log('[sync] Sheet write complete');

  // ---- Update watermark only after successful write ----
  SheetWriter.setConfigValue(ss, keys.lastRunAt, new Date().toISOString());
  if (latestCreatedAt) {
    SheetWriter.setConfigValue(ss, keys.lastSyncedAt, latestCreatedAt);
    Logger.log('[sync] Advancing lastSyncedAt to %s', latestCreatedAt);
  }
  SheetWriter.flushConfigCache(ss);

  var elapsedMs = Date.now() - startMs;
  Logger.log('[sync] Complete: added %s row(s) in %sms', rows.length, elapsedMs);

  if (timedOut) {
    Logger.log('[sync] NOTE: Fetch was cut short by time budget. Run sync again to pick up remaining questions.');
  }

  return { added: rows.length, timedOut: timedOut };
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
