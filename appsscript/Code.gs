/* Spreadsheet menu and operator controls. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Meta Publisher')
    .addItem('1. Setup and connect', 'openSetup')
    .addItem('2. Validate approved rows', 'validateApprovedRows')
    .addItem('3. Preview next action', 'previewNextAction')
    .addSeparator()
    .addItem('Enable automatic posting', 'enableAutomaticPosting')
    .addItem('Pause automatic posting', 'pauseAutomaticPosting')
    .addItem('Show connection and run status', 'showRunStatus')
    .addSeparator()
    .addItem('Install queue dropdowns and formatting', 'applyQueueControls')
    .addToUi();
}

function openSetup() {
  var output = HtmlService.createHtmlOutputFromFile('Settings').setWidth(580).setHeight(610);
  SpreadsheetApp.getUi().showModalDialog(output, 'Connect Meta Publisher');
}

function enableAutomaticPosting() {
  var config = config_();
  token_();
  var validation = validationResult_();
  if (!validation.approved) throw new Error('Approve one test row before enabling automatic posting.');
  if (validation.problems.length) throw new Error('Approved rows need attention. Run Validate approved rows before enabling posting.');

  var properties = scriptStore_();
  var key = ownerKey_();
  var owner = properties.getProperty('MSP_OWNER');
  if (owner && owner !== key) throw new Error('Only the Google account that owns the existing trigger can enable this publisher.');

  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    'Enable public posting?',
    'Facebook Page: ' + config.page_name + '\n' +
    'Instagram: @' + config.instagram_username + '\n\n' +
    'APPROVED rows will publish automatically when due, even while your computer is off. Checks run approximately every five minutes.\n\n' +
    'Confirm that no other Apps Script, n8n workflow, Meta scheduler, or service is publishing this same queue.',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('A publisher run is active. Try again after it finishes.');
  try {
    properties.setProperty('MSP_ENABLED', 'false');
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === 'postingTick') ScriptApp.deleteTrigger(trigger);
    });
    var trigger = ScriptApp.newTrigger('postingTick').timeBased().everyMinutes(MSP.intervalMinutes).create();
    properties.setProperties({
      MSP_OWNER: key,
      MSP_TRIGGER_ID: String(trigger.getUniqueId()),
      MSP_ENABLED: 'true',
      MSP_LAST_STATUS: 'Enabled. Waiting for the next scheduled check.'
    });
  } finally {
    lock.releaseLock();
  }
  ui.alert('Automatic posting is enabled. Confirm the first test on both public profiles before approving a larger batch.');
}

function pauseAutomaticPosting() {
  var properties = scriptStore_();
  properties.setProperty('MSP_ENABLED', 'false');
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'postingTick') ScriptApp.deleteTrigger(trigger);
  });
  properties.setProperty('MSP_LAST_STATUS', 'Paused by an operator. A request already sent to Meta may still complete.');
  SpreadsheetApp.getUi().alert('Posting paused. Let any active execution finish before editing a prepared or uncertain row.');
}

function runtimeBudgetSummary_(properties, now) {
  var budget;
  try { budget = JSON.parse(properties.getProperty('MSP_BUDGET') || 'null'); } catch (error) {}
  if (!budget || !Number.isFinite(budget.started_at) || !Number.isFinite(budget.used_ms)) return 'Runtime budget: not started.';
  var reset = budget.started_at + 86400000;
  if (now >= reset) return 'Runtime budget: eligible to renew on the next check.';
  var config;
  try { config = config_(); } catch (error) { config = { time_zone: 'Etc/UTC' }; }
  return 'Runtime used: ' + (budget.used_ms / 60000).toFixed(1) + ' / ' + (MSP.dailyRuntimeBudgetMs / 60000) + ' minutes\n' +
    'Budget resets: ' + Utilities.formatDate(new Date(reset), config.time_zone, 'yyyy-MM-dd HH:mm z');
}

function showRunStatus() {
  var properties = scriptStore_();
  var config = {};
  try { config = config_(); } catch (error) {}
  SpreadsheetApp.getUi().alert(
    'Meta Publisher status',
    'Version: ' + MSP.version + '\n' +
    'Enabled: ' + (properties.getProperty('MSP_ENABLED') === 'true' ? 'Yes' : 'No') + '\n' +
    'Page: ' + (config.page_name || 'Not connected') + '\n' +
    'Instagram: ' + (config.instagram_username ? '@' + config.instagram_username : 'Not connected') + '\n' +
    'Timezone: ' + (config.time_zone || 'Not configured') + '\n' +
    'Last check: ' + (properties.getProperty('MSP_LAST_RUN') || 'None') + '\n' +
    (properties.getProperty('MSP_LAST_STATUS') || 'Setup not completed.') + '\n\n' +
    runtimeBudgetSummary_(properties, Date.now()),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function applyQueueControls() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(MSP.queueTab);
  if (!sheet) throw new Error('The ' + MSP.queueTab + ' tab is missing. Import templates/publishing-queue.csv first.');
  MSP_Core.parseRows(readRows_(sheet));
  var last = Math.max(sheet.getMaxRows(), 2);
  sheet.setFrozenRows(1);
  sheet.getRange('D2:D' + last).setNumberFormat('@');
  sheet.getRange('E2:E' + last).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['DRAFT', 'APPROVED'], true).setAllowInvalid(false).build());
  sheet.getRange('K2:K' + last).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Single image', 'Carousel', 'Reel'], true).setAllowInvalid(false).build());
  sheet.getRange('O2:O' + last).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['VERIFIED', 'VERIFIED; VARIABLE DATES FLAGGED', 'VERIFIED; DATE RECONFIRMED'], true).setAllowInvalid(false).build());
  sheet.getRange(1, 1, 1, MSP_Core.HEADERS.length).setBackground('#0f3d36').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('A:Q').setVerticalAlignment('top');
  sheet.setColumnWidth(1, 110); sheet.setColumnWidth(2, 300); sheet.setColumnWidth(3, 440); sheet.setColumnWidth(4, 150); sheet.setColumnWidth(5, 110);
  sheet.setColumnWidths(6, 5, 135); sheet.setColumnWidth(11, 125); sheet.setColumnWidth(12, 230); sheet.setColumnWidths(13, 5, 160);
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).filter(function (protection) { return protection.getDescription() === 'Meta Publisher machine-owned columns'; }).forEach(function (protection) { protection.remove(); });
  sheet.getRange('F:J').protect().setDescription('Meta Publisher machine-owned columns').setWarningOnly(true);
  sheet.getRange('M:N').protect().setDescription('Meta Publisher machine-owned columns').setWarningOnly(true);
  if (!sheet.getFilter()) sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), MSP_Core.HEADERS.length).createFilter();
  SpreadsheetApp.getUi().alert('Dropdowns and formatting installed. Existing values were preserved.');
}
