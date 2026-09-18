/*
 * Meta Social Publisher - pure queue and safety helpers.
 *
 * This file deliberately avoids Apps Script services so it can be tested with
 * Node. Runtime adapters live in the other .gs files.
 */
var MSP_Core = (function () {
  'use strict';

  var HEADERS = [
    'post_id', 'media_files', 'caption', 'publish_at', 'approval',
    'facebook_status', 'instagram_status', 'facebook_state',
    'instagram_state', 'last_error', 'format', 'reel_cover_filename',
    'facebook_post_id', 'instagram_post_id', 'verification', 'topic', 'notes'
  ];

  var TERMINAL_STATUSES = ['PUBLISHED', 'DISABLED', 'REVIEW', 'MISSED'];
  var STATE_STEPS = ['NEW', 'PREPARING', 'UPLOAD', 'PROCESS', 'READY', 'VERIFY', 'DONE', 'REVIEW', 'MISSED'];
  var FORMAT_MAP = {
    'SINGLE IMAGE': 'IMAGE',
    'SINGLE_IMAGE': 'IMAGE',
    'IMAGE': 'IMAGE',
    'POST': 'IMAGE',
    'CAROUSEL': 'CAROUSEL',
    'REEL': 'REEL',
    'REELS': 'REEL'
  };

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function codePointLength(value) {
    return Array.from(String(value == null ? '' : value)).length;
  }

  function normalizeFormat(value) {
    return FORMAT_MAP[text(value).toUpperCase()] || '';
  }

  function safeRelativePath(value) {
    var path = text(value).replace(/\\/g, '/');
    if (!path || path.charAt(0) === '/' || /(^|\/)\.\.?($|\/)/.test(path) || /[\u0000-\u001f]/.test(path)) return '';
    if (path.split('/').some(function (part) { return !part || part.length > 180; })) return '';
    return path;
  }

  function mediaPaths(value) {
    var raw = String(value == null ? '' : value);
    if (!raw.trim()) return [];
    var parts = raw.split('|').map(function (part) { return safeRelativePath(part); });
    if (parts.some(function (part) { return !part; })) return null;
    return parts;
  }

  function validDateParts(y, mo, d, h, mi, sec) {
    if (![y, mo, d, h, mi, sec].every(Number.isFinite)) return false;
    if (y < 2000 || mo < 1 || mo > 12 || h < 0 || h > 23 || mi < 0 || mi > 59 || sec < 0 || sec > 59) return false;
    return d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }

  function parsePublishAt(value, timeZone, localToEpoch) {
    if (Object.prototype.toString.call(value) === '[object Date]' && Number.isFinite(value.getTime())) {
      return { ok: true, epoch: value.getTime(), source: 'date' };
    }

    var raw = text(value);
    var local = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(raw);
    if (local) {
      var lp = {
        year: Number(local[1]), month: Number(local[2]), day: Number(local[3]),
        hour: Number(local[4]), minute: Number(local[5]), second: 0
      };
      if (!validDateParts(lp.year, lp.month, lp.day, lp.hour, lp.minute, lp.second)) return { ok: false };
      if (typeof localToEpoch !== 'function') return { ok: false };
      var localEpoch = Number(localToEpoch(lp, timeZone));
      return Number.isFinite(localEpoch) ? { ok: true, epoch: localEpoch, source: 'local' } : { ok: false };
    }

    var iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(raw);
    if (!iso) return { ok: false };
    var ip = {
      year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]),
      hour: Number(iso[4]), minute: Number(iso[5]), second: Number(iso[6])
    };
    var offHour = Number(iso[8] || 0);
    var offMinute = Number(iso[9] || 0);
    if (!validDateParts(ip.year, ip.month, ip.day, ip.hour, ip.minute, ip.second) || offHour > 14 || offMinute > 59 || (offHour === 14 && offMinute !== 0)) return { ok: false };
    var epoch = Date.parse(raw);
    return Number.isFinite(epoch) ? { ok: true, epoch: epoch, source: 'iso' } : { ok: false };
  }

  function parseState(raw, postId, platform) {
    var value = text(raw);
    if (!value) return { step: 'NEW' };
    var state;
    try { state = JSON.parse(value); } catch (error) {
      throw new Error('Invalid state JSON for ' + postId + ' ' + platform + '. Restore the cell from version history.');
    }
    if (!state || Array.isArray(state) || typeof state !== 'object' || STATE_STEPS.indexOf(state.step) === -1) {
      throw new Error('Unrecognized saved state for ' + postId + ' ' + platform + '.');
    }
    return state;
  }

  function rowFromValues(values, rowNumber) {
    var row = {};
    HEADERS.forEach(function (header, index) { row[header] = values[index] == null ? '' : values[index]; });
    row.row_number = rowNumber;
    row.normalized_format = normalizeFormat(row.format);
    row.media_paths = mediaPaths(row.media_files);
    return row;
  }

  function parseRows(values) {
    if (!Array.isArray(values) || !values.length) throw new Error('The Publishing Queue sheet is empty.');
    var badHeader = HEADERS.findIndex(function (header, index) { return text(values[0][index]) !== header; });
    if (badHeader !== -1) throw new Error('Queue headers must match the template in columns A:Q. First mismatch: ' + HEADERS[badHeader] + '.');
    var seen = Object.create(null);
    var rows = [];
    values.slice(1).forEach(function (valuesRow, index) {
      if (valuesRow.every(function (value) { return !text(value); })) return;
      var row = rowFromValues(valuesRow, index + 2);
      var id = text(row.post_id);
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('Missing or invalid post_id at row ' + row.row_number + '.');
      if (seen[id]) throw new Error('Duplicate post_id: ' + id + '.');
      seen[id] = true;
      rows.push(row);
    });
    return rows;
  }

  function isVariableDateBlocked(row) {
    return text(row.verification).toUpperCase().indexOf('VARIABLE DATES FLAGGED') !== -1;
  }

  function verificationApproved(row) {
    var value = text(row.verification);
    return value === 'VERIFIED' || value === 'VERIFIED; DATE RECONFIRMED';
  }

  function isApproved(row) {
    return text(row.approval) === 'APPROVED';
  }

  function staticRowIssues(row, timeZone, localToEpoch) {
    var issues = [];
    var format = row.normalized_format;
    var paths = row.media_paths;
    if (!format) issues.push('Choose Single image, Carousel, or Reel.');
    if (paths === null) issues.push('media_files contains an empty or unsafe relative path.');
    if (Array.isArray(paths)) {
      if (new Set(paths).size !== paths.length) issues.push('media_files contains a duplicate path.');
      if (format === 'IMAGE' && paths.length !== 1) issues.push('A single-image post needs exactly one media file.');
      if (format === 'CAROUSEL' && (paths.length < 2 || paths.length > 10)) issues.push('A carousel needs 2 to 10 ordered image files.');
      if (format === 'REEL' && paths.length !== 1) issues.push('A Reel needs exactly one MP4 file.');
      if (format === 'IMAGE' || format === 'CAROUSEL') {
        if (paths.some(function (path) { return !/\.jpe?g$/i.test(path); })) issues.push('Image posts and carousels require JPEG files.');
      }
      if (format === 'REEL' && paths.some(function (path) { return !/\.mp4$/i.test(path); })) issues.push('Reels require an MP4 file.');
    }
    var cover = safeRelativePath(row.reel_cover_filename);
    if (text(row.reel_cover_filename) && (!cover || !/\.jpe?g$/i.test(cover))) issues.push('The Reel cover must be a safe relative JPEG path.');
    if (format !== 'REEL' && text(row.reel_cover_filename)) issues.push('reel_cover_filename is only valid for Reels.');
    if (!text(row.caption)) issues.push('Caption is missing.');
    if (codePointLength(row.caption) > 2200) issues.push('Caption exceeds the shared 2,200-character limit.');
    if (!parsePublishAt(row.publish_at, timeZone, localToEpoch).ok) issues.push('Enter publish_at as YYYY-MM-DD HH:mm in the configured timezone.');
    if (isVariableDateBlocked(row)) issues.push('Event dates are still variable. Research the official dates, then use VERIFIED; DATE RECONFIRMED.');
    else if (!verificationApproved(row)) issues.push('Set verification to VERIFIED or VERIFIED; DATE RECONFIRMED before approval.');
    return issues;
  }

  function validateApproved(values, timeZone, localToEpoch) {
    var rows = parseRows(values);
    var approved = rows.filter(isApproved);
    var problems = [];
    approved.forEach(function (row) {
      var stateError = false;
      ['facebook', 'instagram'].forEach(function (platform) {
        try { parseState(row[platform + '_state'], row.post_id, platform); }
        catch (error) {
          stateError = true;
          problems.push({ post_id: text(row.post_id), row_number: row.row_number, message: error.message });
        }
      });
      var finished = !stateError && platformFinished(row, 'facebook') && platformFinished(row, 'instagram');
      if (!finished) {
        staticRowIssues(row, timeZone, localToEpoch).forEach(function (message) {
          problems.push({ post_id: text(row.post_id), row_number: row.row_number, message: message });
        });
      }
    });
    return { approved: approved.length, valid: approved.length - new Set(problems.map(function (problem) { return problem.post_id; })).size, problems: problems, rows: rows };
  }

  function signature(value) {
    var a = 2166136261;
    var b = 5381;
    var input = String(value);
    // Iterate UTF-16 code units instead of code points. Array.from() groups an
    // astral character into one item, and charCodeAt(0) would then hash only
    // its high surrogate, causing different emoji to collide.
    for (var index = 0; index < input.length; index++) {
      var code = input.charCodeAt(index);
      a = Math.imul(a ^ code, 16777619);
      b = Math.imul(b, 33) ^ code;
    }
    return (a >>> 0).toString(16) + (b >>> 0).toString(16);
  }

  function platformFinished(row, platform) {
    var status = text(row[platform + '_status']).toUpperCase();
    if (TERMINAL_STATUSES.indexOf(status) !== -1) return true;
    var state = parseState(row[platform + '_state'], row.post_id, platform);
    return ['DONE', 'REVIEW', 'MISSED'].indexOf(state.step) !== -1;
  }

  function needsReconciliation(row, platform) {
    var state = parseState(row[platform + '_state'], row.post_id, platform);
    return state.step === 'VERIFY' || Boolean(state.pending_action);
  }

  function needsLocalSync(row, platform) {
    var status = text(row[platform + '_status']).toUpperCase();
    var state = parseState(row[platform + '_state'], row.post_id, platform);
    return state.step === 'DONE' && TERMINAL_STATUSES.indexOf(status) === -1;
  }

  function isEligible(row, platform, now, config, localToEpoch) {
    if (platformFinished(row, platform)) return false;
    if (needsReconciliation(row, platform)) return true;
    if (!isApproved(row) || !verificationApproved(row)) return false;
    var parsed = parsePublishAt(row.publish_at, config.time_zone, localToEpoch);
    return parsed.ok && Number(now) >= parsed.epoch - Number(config.prepare_minutes) * 60000;
  }

  return {
    HEADERS: HEADERS,
    TERMINAL_STATUSES: TERMINAL_STATUSES,
    STATE_STEPS: STATE_STEPS,
    text: text,
    codePointLength: codePointLength,
    normalizeFormat: normalizeFormat,
    safeRelativePath: safeRelativePath,
    mediaPaths: mediaPaths,
    parsePublishAt: parsePublishAt,
    parseState: parseState,
    rowFromValues: rowFromValues,
    parseRows: parseRows,
    isVariableDateBlocked: isVariableDateBlocked,
    verificationApproved: verificationApproved,
    isApproved: isApproved,
    staticRowIssues: staticRowIssues,
    validateApproved: validateApproved,
    signature: signature,
    platformFinished: platformFinished,
    needsReconciliation: needsReconciliation,
    needsLocalSync: needsLocalSync,
    isEligible: isEligible
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MSP_Core;
