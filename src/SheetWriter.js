/**
 * Sheet operations: ensure structure, append Q&A rows, set dropdowns, read/write config.
 */

var SheetWriter = (function () {
  'use strict';

  var COL = Config.getCol();
  var HEADERS = Config.getHeadersQALog();
  var REVIEW_STATUS_VALUES = Config.getReviewStatusValues();
  var ACTION_NEEDED_VALUES = Config.getActionNeededValues();
  var CONFIG_KEYS = Config.getConfigKeys();
  var QA_SHEET_NAME = Config.getSheetQALogName();
  var CONFIG_SHEET_NAME = Config.getSheetConfigName();

  /**
   * Gets or creates the Q&A Log sheet and ensures headers.
   * @param {Spreadsheet} ss
   * @returns {Sheet}
   */
  function getOrCreateQALogSheet(ss) {
    var sheet = ss.getSheetByName(QA_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(QA_SHEET_NAME);
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 1) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  /**
   * Gets or creates the Config sheet and ensures key column headers.
   * @param {Spreadsheet} ss
   * @returns {Sheet}
   */
  function getOrCreateConfigSheet(ss) {
    var sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG_SHEET_NAME);
      sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
      sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.appendRow([CONFIG_KEYS.teamId, '']);
      sheet.appendRow([CONFIG_KEYS.botId, '']);
      sheet.appendRow([CONFIG_KEYS.lastSyncedAt, '']);
      sheet.appendRow([CONFIG_KEYS.lastRunAt, '']);
    }
    return sheet;
  }

  /**
   * Reads a config value by key from the Config sheet.
   * @param {Spreadsheet} ss
   * @param {string} key
   * @returns {string}
   */
  function getConfigValue(ss, key) {
    var sheet = getOrCreateConfigSheet(ss);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        return data[i][1] != null ? String(data[i][1]).trim() : '';
      }
    }
    return '';
  }

  /**
   * Writes a config value by key (upserts row).
   * @param {Spreadsheet} ss
   * @param {string} key
   * @param {string} value
   */
  function setConfigValue(ss, key, value) {
    var sheet = getOrCreateConfigSheet(ss);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        return;
      }
    }
    sheet.appendRow([key, value]);
  }

  /**
   * Returns the Question ID of the newest row in the Q&A Log (row 2 when sorted newest first).
   * Used for fast "no new data" check. Returns empty string if sheet has no data rows.
   * @param {Spreadsheet} ss
   * @returns {string}
   */
  function getLatestQuestionId(ss) {
    var sheet = ss.getSheetByName(QA_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return '';
    var val = sheet.getRange(2, COL.QUESTION_ID + 1).getValue();
    return val != null ? String(val).trim() : '';
  }

  /**
   * Returns the set of existing Question IDs in the Q&A Log (for dedup).
   * @param {Spreadsheet} ss
   * @returns {Object.<string, boolean>}
   */
  function getExistingQuestionIds(ss) {
    var sheet = ss.getSheetByName(QA_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return {};
    var ids = sheet.getRange(2, COL.QUESTION_ID + 1, sheet.getLastRow(), COL.QUESTION_ID + 1).getValues();
    var out = {};
    for (var j = 0; j < ids.length; j++) {
      var id = ids[j][0];
      if (id) out[String(id)] = true;
    }
    return out;
  }

  /**
   * Builds one row for the Q&A Log from a DocsBot question object (question/answer already scrubbed).
   * @param {Object} q - Raw question from API
   * @param {string} questionScrubbed
   * @param {string} answerScrubbed
   * @returns {Array}
   */
  function buildRow(q, questionScrubbed, answerScrubbed) {
    var questionId = q.id || '';
    var createdAt = q.createdAt || '';
    var couldAnswer = q.couldAnswer === true;
    var rating = q.rating != null ? q.rating : '';
    var referrer = (q.metadata && q.metadata.referrer) ? String(q.metadata.referrer) : '';
    var sourcesStr = formatSources(q.sources);
    return [
      questionId,
      formatDateTime(createdAt),
      truncateForCell(questionScrubbed, 'Question', questionId),
      truncateForCell(answerScrubbed, 'Bot Answer', questionId),
      couldAnswer ? 'YES' : 'NO',
      truncateForCell(sourcesStr, 'Sources', questionId),
      rating,
      truncateForCell(referrer, 'Referrer', questionId),
      'Pending Review',
      '', // Action Needed - empty until reviewer chooses
      '',
      ''
    ];
  }

  /**
   * Appends rows to Q&A Log and applies dropdown validation to the new rows.
   * @param {Spreadsheet} ss
   * @param {Array.<Array>} rows - Array of row arrays
   */
  function appendRows(ss, rows) {
    if (!rows || rows.length === 0) return;
    var sheet = getOrCreateQALogSheet(ss);
    var startRow = sheet.getLastRow() + 1;
    var numRows = rows.length;
    var numCols = HEADERS.length;

    // getRange(row, column, numRows, numColumns) — 3rd/4th args are counts, not end row/col
    sheet.getRange(startRow, 1, numRows, numCols).setValues(rows);

    var reviewStatusCol = COL.REVIEW_STATUS + 1;
    var actionNeededCol = COL.ACTION_NEEDED + 1;

    var reviewRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(REVIEW_STATUS_VALUES, true)
      .build();
    var actionRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(ACTION_NEEDED_VALUES, true)
      .build();

    sheet.getRange(startRow, reviewStatusCol, numRows, 1).setDataValidation(reviewRule);
    sheet.getRange(startRow, actionNeededCol, numRows, 1).setDataValidation(actionRule);

    sheet.getRange(startRow, 1, numRows, numCols).setWrap(true);
  }

  /**
   * Sorts the Q&A Log data by Date/Time (column B) descending — newest first.
   * Header row (row 1) is left in place; only data rows are sorted.
   * @param {Spreadsheet} ss
   */
  function sortQALogByNewestFirst(ss) {
    var sheet = ss.getSheetByName(QA_SHEET_NAME);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var numCols = HEADERS.length;
    var dataRange = sheet.getRange(2, 1, lastRow - 1, numCols);
    var dateTimeCol = COL.DATE_TIME + 1; // 1-based column index (B = 2)
    dataRange.sort({ column: dateTimeCol, ascending: false });
  }

  return {
    getOrCreateQALogSheet: getOrCreateQALogSheet,
    getOrCreateConfigSheet: getOrCreateConfigSheet,
    getConfigValue: getConfigValue,
    setConfigValue: setConfigValue,
    getLatestQuestionId: getLatestQuestionId,
    getExistingQuestionIds: getExistingQuestionIds,
    buildRow: buildRow,
    appendRows: appendRows,
    sortQALogByNewestFirst: sortQALogByNewestFirst,
    getConfigKeys: function () { return CONFIG_KEYS; }
  };
})();
