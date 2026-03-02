/**
 * Sheet operations: ensure structure, insert Q&A rows, set dropdowns, read/write config.
 *
 * I/O strategy:
 *   - Config sheet: read once into cache, dirty values flushed in a single setValues call.
 *   - Q&A rows: inserted at the top (after header) so the sheet stays newest-first
 *     without a post-write sort.  One setValues + one insertRowsAfter per sync.
 *   - Validation rules are applied per-column-range, not per-row.
 */

var SheetWriter = (function () {
  'use strict';

  var COL = Config.getCol();
  var HEADERS = Config.getHeadersQALog();
  var NUM_COLS = HEADERS.length;
  var REVIEW_STATUS_VALUES = Config.getReviewStatusValues();
  var ACTION_NEEDED_VALUES = Config.getActionNeededValues();
  var CONFIG_KEYS = Config.getConfigKeys();
  var QA_SHEET_NAME = Config.getSheetQALogName();
  var CONFIG_SHEET_NAME = Config.getSheetConfigName();

  // Google Sheets hard limit: 10,000,000 cells per spreadsheet
  var MAX_CELLS_PER_WRITE = 10000000;

  // ---------------------------------------------------------------------------
  // Config cache: read once, write once
  // ---------------------------------------------------------------------------

  var _configCache = null;   // { key: { value: string, row: number } }
  var _configDirty = {};     // keys that were changed since last flush
  var _configSheet = null;   // cached Sheet reference

  /**
   * Ensures the Config sheet exists and returns it. Cached per execution.
   * @param {Spreadsheet} ss
   * @returns {Sheet}
   */
  function getOrCreateConfigSheet(ss) {
    if (_configSheet) return _configSheet;
    _configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    if (!_configSheet) {
      _configSheet = ss.insertSheet(CONFIG_SHEET_NAME);
      _configSheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
      _configSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
      _configSheet.setFrozenRows(1);
      _configSheet.appendRow([CONFIG_KEYS.teamId, '']);
      _configSheet.appendRow([CONFIG_KEYS.botId, '']);
      _configSheet.appendRow([CONFIG_KEYS.lastSyncedAt, '']);
      _configSheet.appendRow([CONFIG_KEYS.lastRunAt, '']);
    }
    return _configSheet;
  }

  /**
   * Loads every key-value pair from the Config sheet into memory.
   * Call once at the start of an execution that needs config values.
   * @param {Spreadsheet} ss
   */
  function loadConfigCache(ss) {
    var sheet = getOrCreateConfigSheet(ss);
    var data = sheet.getDataRange().getValues();
    _configCache = {};
    _configDirty = {};
    for (var i = 1; i < data.length; i++) {
      var key = data[i][0] != null ? String(data[i][0]).trim() : '';
      var val = data[i][1] != null ? String(data[i][1]).trim() : '';
      if (key) {
        _configCache[key] = { value: val, row: i + 1 };
      }
    }
  }

  /**
   * Reads a config value from the in-memory cache.
   * Falls back to a sheet read if the cache hasn't been loaded yet.
   * @param {Spreadsheet} ss
   * @param {string} key
   * @returns {string}
   */
  function getConfigValue(ss, key) {
    if (!_configCache) loadConfigCache(ss);
    var entry = _configCache[key];
    return entry ? entry.value : '';
  }

  /**
   * Sets a config value in the in-memory cache and marks it dirty.
   * The actual sheet write happens in flushConfigCache().
   * @param {Spreadsheet} ss
   * @param {string} key
   * @param {string} value
   */
  function setConfigValue(ss, key, value) {
    if (!_configCache) loadConfigCache(ss);
    var strVal = value != null ? String(value).trim() : '';
    var entry = _configCache[key];
    if (entry) {
      if (entry.value === strVal) return;
      entry.value = strVal;
    } else {
      var sheet = getOrCreateConfigSheet(ss);
      var nextRow = sheet.getLastRow() + 1;
      _configCache[key] = { value: strVal, row: nextRow };
    }
    _configDirty[key] = true;
  }

  /**
   * Writes all dirty config values back to the Config sheet in O(1) I/O.
   * Reads the sheet once, mutates values in-memory, writes the full array back
   * in a single setValues call.
   * @param {Spreadsheet} ss
   */
  function flushConfigCache(ss) {
    var dirtyKeys = Object.keys(_configDirty);
    if (dirtyKeys.length === 0) return;
    var sheet = getOrCreateConfigSheet(ss);

    var lastRow = sheet.getLastRow();
    var data = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 2).getValues() : [];

    var keyIndex = {};
    for (var r = 1; r < data.length; r++) {
      var k = data[r][0] != null ? String(data[r][0]).trim() : '';
      if (k) keyIndex[k] = r;
    }

    for (var i = 0; i < dirtyKeys.length; i++) {
      var key = dirtyKeys[i];
      var entry = _configCache[key];
      if (!entry) continue;

      if (keyIndex[key] !== undefined) {
        data[keyIndex[key]][1] = entry.value;
        entry.row = keyIndex[key] + 1;
      } else {
        data.push([key, entry.value]);
        entry.row = data.length;
      }
    }

    sheet.getRange(1, 1, data.length, 2).setValues(data);
    _configDirty = {};
  }

  /**
   * Resets the config cache. Call at the end of an execution or if the Config
   * sheet may have been changed externally (e.g. by menuSetupIds).
   */
  function resetConfigCache() {
    _configCache = null;
    _configDirty = {};
    _configSheet = null;
  }

  // ---------------------------------------------------------------------------
  // Q&A Log sheet
  // ---------------------------------------------------------------------------

  /**
   * Gets or creates the Q&A Log sheet and ensures headers exist.
   * @param {Spreadsheet} ss
   * @returns {Sheet}
   */
  function getOrCreateQALogSheet(ss) {
    var sheet = ss.getSheetByName(QA_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(QA_SHEET_NAME);
    }
    if (sheet.getLastRow() < 1) {
      sheet.getRange(1, 1, 1, NUM_COLS).setValues([HEADERS]);
      sheet.getRange(1, 1, 1, NUM_COLS).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  /**
   * Returns the Question ID of the newest row (row 2 when sorted newest-first).
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
   * Returns a lookup object of all existing Question IDs for dedup.
   * Single getValues call on the ID column.
   * @param {Spreadsheet} ss
   * @returns {Object.<string, boolean>}
   */
  function getExistingQuestionIds(ss) {
    var sheet = ss.getSheetByName(QA_SHEET_NAME);
    if (!sheet) return {};
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    var numDataRows = lastRow - 1;
    var ids = sheet.getRange(2, COL.QUESTION_ID + 1, numDataRows, 1).getValues();
    var out = {};
    for (var j = 0; j < ids.length; j++) {
      var id = ids[j][0];
      if (id) out[String(id)] = true;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Row building with explicit type safety
  // ---------------------------------------------------------------------------

  /**
   * Builds a single row array from a DocsBot question object.
   * All values are explicitly typed to prevent Sheets auto-formatting issues:
   *   - IDs → String (avoids scientific notation on long numeric IDs)
   *   - Date → JS Date object (Sheets formats natively)
   *   - Rating → Number or empty string
   *   - Everything else → String
   * @param {Object} q - Raw question from API
   * @param {string} questionScrubbed
   * @param {string} answerScrubbed
   * @returns {Array}
   */
  function buildRow(q, questionScrubbed, answerScrubbed) {
    var questionId = q.id != null ? String(q.id) : '';
    var couldAnswer = q.couldAnswer === true;
    var rating = (q.rating != null && q.rating !== '') ? Number(q.rating) : '';
    var referrer = (q.metadata && q.metadata.referrer) ? String(q.metadata.referrer) : '';
    var sourcesStr = formatSources(q.sources);

    // Parse date as a JS Date so Sheets applies native date formatting
    var dateValue = '';
    if (q.createdAt) {
      var d = new Date(q.createdAt);
      if (!isNaN(d.getTime())) dateValue = d;
    }

    var row = [
      questionId,
      dateValue,
      truncateForCell(String(questionScrubbed), 'Question', questionId),
      truncateForCell(String(answerScrubbed), 'Bot Answer', questionId),
      couldAnswer ? 'YES' : 'NO',
      truncateForCell(String(sourcesStr), 'Sources', questionId),
      rating,
      truncateForCell(String(referrer), 'Referrer', questionId),
      'Pending Review',
      '',
      '',
      ''
    ];

    if (row.length !== NUM_COLS) {
      Logger.log(
        'COLUMN MISMATCH: buildRow produced %s columns but expected %s for questionId=%s',
        row.length, NUM_COLS, questionId
      );
    }

    return row;
  }

  // ---------------------------------------------------------------------------
  // Insert-at-top: keeps newest-first order without a post-write sort
  // ---------------------------------------------------------------------------

  /**
   * Inserts rows at the top of the Q&A Log (directly after the header row)
   * so the sheet stays in newest-first order without a full-range sort.
   *
   * Expects rows to already be in newest-first order (index 0 = newest).
   *
   * Guards:
   *   - Skips if rows is empty.
   *   - Throws if total cells would exceed Google's 10M cell limit.
   *   - Validates column width of every row against HEADERS.length.
   *
   * @param {Spreadsheet} ss
   * @param {Array.<Array>} rows - Newest-first order
   */
  function appendRows(ss, rows) {
    if (!rows || rows.length === 0) return;

    var numRows = rows.length;

    var totalCells = numRows * NUM_COLS;
    if (totalCells > MAX_CELLS_PER_WRITE) {
      throw new Error(
        'Batch too large: ' + totalCells + ' cells exceeds the ' +
        MAX_CELLS_PER_WRITE + ' cell limit. Reduce the sync window or paginate writes.'
      );
    }

    for (var v = 0; v < numRows; v++) {
      if (rows[v].length !== NUM_COLS) {
        Logger.log(
          'COLUMN MISMATCH on row index %s: got %s columns, expected %s. Row data: %s',
          v, rows[v].length, NUM_COLS, JSON.stringify(rows[v]).substring(0, 200)
        );
        throw new Error(
          'Column mismatch on row ' + v + ': got ' + rows[v].length +
          ' columns but the sheet has ' + NUM_COLS + '. Aborting to prevent data corruption.'
        );
      }
    }

    var sheet = getOrCreateQALogSheet(ss);

    sheet.insertRowsAfter(1, numRows);

    var insertRange = sheet.getRange(2, 1, numRows, NUM_COLS);
    insertRange.setValues(rows);
    insertRange.setFontWeight('normal');
    insertRange.setWrap(true);

    var reviewRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(REVIEW_STATUS_VALUES, true)
      .build();
    var actionRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(ACTION_NEEDED_VALUES, true)
      .build();

    sheet.getRange(2, COL.REVIEW_STATUS + 1, numRows, 1).setDataValidation(reviewRule);
    sheet.getRange(2, COL.ACTION_NEEDED + 1, numRows, 1).setDataValidation(actionRule);
  }

  // ---------------------------------------------------------------------------
  // Sort
  // ---------------------------------------------------------------------------

  /**
   * Sorts all data rows by Date/Time (column B) descending.
   * Header row is excluded from the sort range.
   *
   * No longer called by the sync flow (insert-at-top keeps order).
   * Retained as a manual utility for one-off re-sorts if needed.
   * @param {Spreadsheet} ss
   */
  function sortQALogByNewestFirst(ss) {
    var sheet = ss.getSheetByName(QA_SHEET_NAME);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return; // need at least 2 data rows to sort
    var dataRange = sheet.getRange(2, 1, lastRow - 1, NUM_COLS);
    dataRange.sort({ column: COL.DATE_TIME + 1, ascending: false });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    loadConfigCache: loadConfigCache,
    getConfigValue: getConfigValue,
    setConfigValue: setConfigValue,
    flushConfigCache: flushConfigCache,
    resetConfigCache: resetConfigCache,
    getOrCreateQALogSheet: getOrCreateQALogSheet,
    getOrCreateConfigSheet: getOrCreateConfigSheet,
    getLatestQuestionId: getLatestQuestionId,
    getExistingQuestionIds: getExistingQuestionIds,
    buildRow: buildRow,
    appendRows: appendRows,
    sortQALogByNewestFirst: sortQALogByNewestFirst,
    getConfigKeys: function () { return CONFIG_KEYS; }
  };
})();
