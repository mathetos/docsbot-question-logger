/**
 * Helpers: date formatting, source array formatting, cell truncation.
 */

var MAX_CELL_SUFFIX = ' [truncated]';

/**
 * Truncates a string to fit within Google Sheets' 50,000 character limit per cell.
 * Logs to the Apps Script execution transcript when truncation occurs (View > Executions, or Run and check Logs).
 * @param {string} str - Value to truncate
 * @param {string} fieldName - Column/field name for logging (e.g. "Question", "Bot Answer")
 * @param {string} questionId - DocsBot question ID for logging
 * @returns {string} Truncated string with " [truncated]" suffix if trimmed
 */
function truncateForCell(str, fieldName, questionId) {
  'use strict';
  if (str == null || typeof str !== 'string') return str;
  var max = Config.getMaxCellChars();
  if (str.length <= max) return str;
  if (typeof Logger !== 'undefined') {
    Logger.log('Truncated cell: questionId=%s, field=%s, originalLength=%s', questionId || '', fieldName || '', str.length);
  }
  return str.substring(0, max - MAX_CELL_SUFFIX.length) + MAX_CELL_SUFFIX;
}

/**
 * Formats an ISO date string for display in the sheet (local time).
 * @param {string} isoDate - ISO 8601 date string
 * @returns {string} Formatted date/time string or empty string
 */
function formatDateTime(isoDate) {
  'use strict';
  if (!isoDate) return '';
  var d = new Date(isoDate);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Formats the sources array from a DocsBot question into a single string.
 * Each source: "Title — URL" on its own line.
 * @param {Array.<Object>} sources - Array of { title, url }
 * @returns {string}
 */
function formatSources(sources) {
  'use strict';
  if (!sources || !Array.isArray(sources) || sources.length === 0) return '';
  var parts = [];
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i];
    var title = (s && s.title) ? String(s.title).trim() : '';
    var url = (s && s.url) ? String(s.url).trim() : '';
    if (title || url) {
      parts.push(title ? title + (url ? ' — ' + url : '') : url);
    }
  }
  return parts.join('\n');
}
