/* Configuration and connection management. */
var MSP = Object.freeze({
  version: '1.0.0',
  apiVersion: 'v26.0',
  intervalMinutes: 5,
  queueTab: 'Publishing Queue',
  maxRows: 1000,
  maxVideoBytes: 20 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  prepareMinutes: 60,
  maxLateMinutes: 30,
  maxOperationsPerRun: 8,
  maxRunMs: 240000,
  dailyRuntimeBudgetMs: 3600000
});

function userStore_() { return PropertiesService.getUserProperties(); }
function scriptStore_() { return PropertiesService.getScriptProperties(); }

function ownerKey_() {
  var properties = userStore_();
  var key = properties.getProperty('MSP_USER_KEY');
  if (!key) {
    key = Utilities.getUuid();
    properties.setProperty('MSP_USER_KEY', key);
  }
  return key;
}

function folderId_(value) {
  var raw = String(value || '').trim();
  var match = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/.exec(raw);
  var id = match ? match[1] : raw;
  if (!/^[A-Za-z0-9_-]{8,}$/.test(id)) throw new Error('Paste a valid Google Drive folder link or folder ID.');
  return id;
}

function validateTimeZone_(timeZone) {
  var zone = String(timeZone || '').trim();
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(zone)) throw new Error('Enter an IANA timezone such as Asia/Karachi.');
  try { Utilities.formatDate(new Date(), zone, 'yyyy-MM-dd HH:mm'); }
  catch (error) { throw new Error('Google Apps Script did not recognize that timezone.'); }
  return zone;
}

function config_() {
  var saved;
  try { saved = JSON.parse(userStore_().getProperty('MSP_CONFIG') || 'null'); }
  catch (error) { throw new Error('Saved setup is invalid. Open Meta Publisher → Setup and connect again.'); }
  if (!saved) throw new Error('Open Meta Publisher → Setup and connect before using the publisher.');
  if (!/^[A-Za-z0-9_-]{8,}$/.test(String(saved.sheet_id || '')) || !/^[A-Za-z0-9_-]{8,}$/.test(String(saved.drive_folder_id || ''))) {
    throw new Error('Saved Google configuration is invalid. Open Setup and connect again.');
  }
  if (!/^\d+$/.test(String(saved.page_id || '')) || !/^\d+$/.test(String(saved.instagram_id || ''))) {
    throw new Error('Saved Meta configuration is invalid. Open Setup and connect again.');
  }
  saved.time_zone = validateTimeZone_(saved.time_zone || 'Asia/Karachi');
  return Object.assign({}, saved, {
    api_version: MSP.apiVersion,
    queue_tab: saved.queue_tab || MSP.queueTab,
    live: scriptStore_().getProperty('MSP_ENABLED') === 'true',
    prepare_minutes: MSP.prepareMinutes,
    max_late_minutes: MSP.maxLateMinutes,
    max_video_bytes: MSP.maxVideoBytes,
    max_image_bytes: MSP.maxImageBytes,
    execution_id: Utilities.getUuid()
  });
}

function token_() {
  var token = userStore_().getProperty('MSP_META_TOKEN');
  if (!token) throw new Error('Connect a Meta Page access token first.');
  return token;
}

function queueSheet_(config) {
  var sheet = SpreadsheetApp.openById(config.sheet_id).getSheetByName(config.queue_tab);
  if (!sheet) throw new Error('The ' + config.queue_tab + ' tab is missing.');
  return sheet;
}

function readRows_(sheet) {
  if (sheet.getLastRow() > MSP.maxRows + 1) throw new Error('This release supports at most ' + MSP.maxRows + ' queue rows. Archive completed rows first.');
  return sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), MSP_Core.HEADERS.length).getValues();
}

function timeZoneOffsetMs_(epoch, timeZone) {
  var value = Utilities.formatDate(new Date(epoch), timeZone, 'Z');
  var match = /^([+-])(\d{2}):?(\d{2})$/.exec(value);
  if (!match) throw new Error('Could not calculate the configured timezone offset.');
  var minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -1 : 1) * minutes * 60000;
}

function localToEpoch_(parts, timeZone) {
  var wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  var guess = wall;
  for (var index = 0; index < 4; index++) {
    var next = wall - timeZoneOffsetMs_(guess, timeZone);
    if (next === guess) break;
    guess = next;
  }
  var expected = [
    String(parts.year).padStart(4, '0'), '-', String(parts.month).padStart(2, '0'), '-',
    String(parts.day).padStart(2, '0'), ' ', String(parts.hour).padStart(2, '0'), ':',
    String(parts.minute).padStart(2, '0')
  ].join('');
  return Utilities.formatDate(new Date(guess), timeZone, 'yyyy-MM-dd HH:mm') === expected ? guess : NaN;
}

function saveSetup(form) {
  var scriptProperties = scriptStore_();
  if (scriptProperties.getProperty('MSP_ENABLED') === 'true') throw new Error('Pause automatic posting before changing the connection.');
  var existingOwner = scriptProperties.getProperty('MSP_OWNER');
  if (existingOwner && existingOwner !== ownerKey_()) throw new Error('Use the Google account that originally enabled this publisher.');

  var folderId = folderId_(form.folder);
  var expectedPage = String(form.expected_page_name || '').trim();
  if (!expectedPage) throw new Error('Enter the exact Facebook Page name you intend to connect.');
  var timeZone = validateTimeZone_(form.time_zone || 'Asia/Karachi');
  var suppliedToken = String(form.token || '').trim();
  var accessToken = suppliedToken || userStore_().getProperty('MSP_META_TOKEN') || '';
  if (accessToken.length < 20 || /[\r\n]/.test(accessToken)) throw new Error('Enter the Page access token without a Bearer or OAuth prefix.');

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this project through Extensions → Apps Script in the publishing spreadsheet.');
  var queue = spreadsheet.getSheetByName(MSP.queueTab);
  if (!queue) throw new Error('The spreadsheet must contain the ' + MSP.queueTab + ' tab from the template.');
  MSP_Core.parseRows(readRows_(queue));

  var folder;
  try { folder = DriveApp.getFolderById(folderId); folder.getName(); }
  catch (error) { throw new Error('This Google account cannot read the selected Drive folder.'); }

  var response = metaRequest_('me', 'GET', { fields: 'id,name,instagram_business_account{id,username}' }, null, accessToken);
  var page = response.body || {};
  var instagram = page.instagram_business_account || {};
  if (!response.ok) throw new Error('Meta could not verify the Page token. Check its app, permissions, account access, and expiry.');
  if (!/^\d+$/.test(String(page.id || '')) || !/^\d+$/.test(String(instagram.id || ''))) {
    throw new Error('Meta did not return both a Facebook Page and linked professional Instagram account.');
  }
  if (String(page.name || '').trim().toLowerCase() !== expectedPage.toLowerCase()) {
    throw new Error('The token belongs to “' + String(page.name || 'another Page') + '”, not “' + expectedPage + '”.');
  }

  var config = {
    sheet_id: spreadsheet.getId(),
    drive_folder_id: folderId,
    page_id: String(page.id),
    instagram_id: String(instagram.id),
    page_name: String(page.name),
    instagram_username: String(instagram.username || ''),
    folder_name: folder.getName(),
    expected_page_name: expectedPage,
    time_zone: timeZone,
    queue_tab: MSP.queueTab
  };
  userStore_().setProperties({ MSP_CONFIG: JSON.stringify(config), MSP_META_TOKEN: accessToken });
  return {
    page: config.page_name,
    instagram: config.instagram_username,
    folder: config.folder_name,
    time_zone: config.time_zone,
    message: 'Connected. Nothing will publish until a row is APPROVED and automatic posting is enabled.'
  };
}

function getSetupSummary() {
  try {
    var config = config_();
    return {
      configured: true,
      page: config.page_name,
      instagram: config.instagram_username,
      folder: config.folder_name,
      time_zone: config.time_zone
    };
  } catch (error) {
    return { configured: false };
  }
}
