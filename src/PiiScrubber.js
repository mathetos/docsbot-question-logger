/**
 * PII scrubbing for question and answer text before writing to the sheet.
 * Uses regex patterns; cannot detect names, addresses, or other unstructured PII.
 */

var PiiScrubber = (function () {
  'use strict';

  var REDACT_EMAIL = '[PII-EMAIL]';
  var REDACT_PHONE = '[PII-PHONE]';
  var REDACT_SSN = '[PII-SSN]';
  var REDACT_CC = '[PII-CC]';
  var REDACT_IP = '[PII-IP]';

  // Email: local@domain.tld
  var RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  // US/international phone: (123) 456-7890, 123-456-7890, +1 123 456 7890, etc.
  var RE_PHONE = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:[-.\s]?x?\d{1,6})?/g;
  // SSN: 123-45-6789
  var RE_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
  // Credit card: 16 digits, optional spaces/dashes (grouped)
  var RE_CC = /\b(?:\d{4}[\s-]?){3}\d{4}\b/g;
  // IPv4
  var RE_IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

  function scrub(str) {
    if (typeof str !== 'string' || str.length === 0) return str;
    var out = str;
    out = out.replace(RE_EMAIL, REDACT_EMAIL);
    out = out.replace(RE_PHONE, REDACT_PHONE);
    out = out.replace(RE_SSN, REDACT_SSN);
    out = out.replace(RE_CC, REDACT_CC);
    out = out.replace(RE_IP, REDACT_IP);
    return out;
  }

  return {
    scrub: scrub
  };
})();
