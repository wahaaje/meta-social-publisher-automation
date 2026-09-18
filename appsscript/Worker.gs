/* Queue validation, planning, state transitions, and scheduled execution. */
function statusForStep_(step) {
  return ({
    NEW: 'PENDING', PREPARING: 'PREPARING', UPLOAD: 'UPLOADING',
    PROCESS: 'PROCESSING', READY: 'READY', VERIFY: 'PUBLISHING',
    DONE: 'PUBLISHED', REVIEW: 'REVIEW', MISSED: 'MISSED'
  })[step] || 'PENDING';
}

function writePlatformState_(sheet, row, platform, state, status, error, publishedId) {
  var statusColumn = platform === 'facebook' ? 6 : 7;
  var stateColumn = platform === 'facebook' ? 8 : 9;
  var idColumn = platform === 'facebook' ? 13 : 14;
  if (publishedId) sheet.getRange(row.row_number, idColumn).setValue(String(publishedId));
  sheet.getRange(row.row_number, stateColumn).setValue(JSON.stringify(state));
  var errorCell = sheet.getRange(row.row_number, 10);
  function savedError(raw, label) {
    if (!MSP_Core.text(raw)) return '';
    try {
      var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return parsed && parsed.last_error ? label + ': ' + String(parsed.last_error) : '';
    } catch (parseError) {
      return label + ': Invalid state JSON.';
    }
  }
  var facebookError = platform === 'facebook'
    ? ((state.last_error || error) ? 'facebook: ' + String(state.last_error || error) : '')
    : savedError(row.facebook_state, 'facebook');
  var instagramError = platform === 'instagram'
    ? ((state.last_error || error) ? 'instagram: ' + String(state.last_error || error) : '')
    : savedError(row.instagram_state, 'instagram');
  var combinedError = [facebookError, instagramError].filter(Boolean).join('\n');
  if (combinedError) errorCell.setValue(combinedError);
  else errorCell.clearContent();
  // Visible status is written last. If a partial write occurs, the state still
  // prevents replay and a later run can safely reconcile the display fields.
  sheet.getRange(row.row_number, statusColumn).setValue(status || statusForStep_(state.step));
  SpreadsheetApp.flush();
}

function reviewState_(sheet, row, platform, state, message) {
  var next = Object.assign({}, state, {
    step: 'REVIEW',
    last_error: message,
    updated_at: new Date().toISOString()
  });
  delete next.pending_action;
  delete next.pending_since;
  var currentStatus = MSP_Core.text(row[platform + '_status']).toUpperCase();
  var visibleStatus = ['PUBLISHED', 'DISABLED'].indexOf(currentStatus) !== -1 ? currentStatus : 'REVIEW';
  writePlatformState_(sheet, row, platform, next, visibleStatus, message);
}

function missedState_(sheet, row, platform, state) {
  var message = 'Scheduled time was missed. Choose a new time only after reviewing both public profiles and saved state.';
  var next = Object.assign({}, state, { step: 'MISSED', last_error: message, updated_at: new Date().toISOString() });
  delete next.pending_action;
  delete next.pending_since;
  writePlatformState_(sheet, row, platform, next, 'MISSED', message);
}

function findRow_(sheet, postId) {
  var rows = MSP_Core.parseRows(readRows_(sheet));
  var row = rows.find(function (candidate) { return String(candidate.post_id) === String(postId); });
  if (!row) throw new Error('The queue row was removed. Remote work may have succeeded; inspect Meta before retrying.');
  return row;
}

function materialFieldsMatch_(left, right, platform) {
  var fields = ['post_id', 'media_files', 'caption', 'publish_at', 'approval', 'format', 'reel_cover_filename', 'verification', 'topic'];
  fields.push(platform + '_status', platform + '_state');
  return fields.every(function (field) { return String(left[field] == null ? '' : left[field]) === String(right[field] == null ? '' : right[field]); });
}

function claimMutation_(sheet, plan) {
  var current = findRow_(sheet, plan.row.post_id);
  if (!materialFieldsMatch_(plan.row, current, plan.platform)) {
    throw new Error('The queue row changed while planning. No Meta mutation was made.');
  }
  var state = Object.assign({}, plan.state, {
    signature: plan.signature,
    pending_action: plan.action,
    pending_since: new Date().toISOString(),
    operation_id: Utilities.getUuid(),
    updated_at: new Date().toISOString()
  });
  if (plan.is_publish) state.step = 'VERIFY';
  var previousStatus = MSP_Core.text(current[plan.platform + '_status']).toUpperCase();
  var claimStatus = previousStatus === 'DISABLED' ? 'DISABLED' : (plan.is_publish ? 'PUBLISHING' : 'PREPARING');
  writePlatformState_(sheet, current, plan.platform, state, claimStatus, '');
  // Re-find by immutable post_id before any network mutation. A collaborator
  // sorting the Sheet during the write must never make us publish without the
  // intended row carrying this exact operation claim.
  return { row: assertClaim_(sheet, current.post_id, plan.platform, state.operation_id), state: state };
}

function assertClaim_(sheet, postId, platform, operationId) {
  var current = findRow_(sheet, postId);
  var saved = MSP_Core.parseState(current[platform + '_state'], postId, platform);
  if (saved.operation_id !== operationId) throw new Error('Saved operation changed during execution. Inspect Meta before continuing.');
  return current;
}

function pendingCandidate_(row, platform, state, format, now) {
  if (state.step === 'VERIFY') {
    var verifyAction = platform === 'instagram' ? 'IG_VERIFY' : (format === 'REEL' ? 'FB_REEL_VERIFY' : 'LOCAL_REVIEW');
    return {
      action: verifyAction,
      message: verifyAction === 'LOCAL_REVIEW' ? 'A Facebook image publication may have succeeded. Inspect the Page before resetting this row.' : ''
    };
  }
  if (!state.pending_action) return null;
  if (['IG_PUBLISH', 'FB_REEL_PUBLISH'].indexOf(state.pending_action) !== -1) {
    var pendingVerifyAction = platform === 'instagram' ? 'IG_VERIFY' : (format === 'REEL' ? 'FB_REEL_VERIFY' : 'LOCAL_REVIEW');
    return {
      action: pendingVerifyAction,
      message: pendingVerifyAction === 'LOCAL_REVIEW' ? 'A Facebook image publication may have succeeded. Inspect the Page before resetting this row.' : ''
    };
  }
  var since = Date.parse(String(state.pending_since || ''));
  if (Number.isFinite(since) && now - since < 120000) return { action: 'WAIT' };
  return { action: 'LOCAL_REVIEW', message: 'An earlier ' + String(state.pending_action).toLowerCase().replace(/_/g, ' ') + ' has an uncertain result. Inspect Meta and Apps Script before retrying.' };
}

function actionPlan_(row, platform, state, action, due, priority, resolved, signature, extra) {
  return Object.assign({
    row: row,
    platform: platform,
    state: state,
    action: action,
    due: due,
    priority: priority,
    resolved: resolved,
    signature: signature || state.signature || '',
    is_publish: ['FB_IMAGE_PUBLISH', 'IG_PUBLISH', 'FB_REEL_PUBLISH'].indexOf(action) !== -1
  }, extra || {});
}

function addReconciliationPlans_(plans, row, now) {
  ['facebook', 'instagram'].forEach(function (platform) {
    var state = MSP_Core.parseState(row[platform + '_state'], row.post_id, platform);
    if (MSP_Core.platformFinished(row, platform) && !state.pending_action && state.step !== 'VERIFY') return;
    var pending = pendingCandidate_(row, platform, state, row.normalized_format, now);
    if (!pending || pending.action === 'WAIT') return;
    if (pending.action.indexOf('VERIFY') !== -1 && !/^\d+$/.test(String(state.remote_id || ''))) {
      pending = { action: 'LOCAL_REVIEW', message: 'An in-flight publication has no remote ID. Inspect Meta before resetting this row.' };
    }
    plans.push(actionPlan_(row, platform, state, pending.action, 0, 0, null, state.signature || '', { message: pending.message || '' }));
  });
}

function addConsistencyPlans_(plans, row) {
  ['facebook', 'instagram'].forEach(function (platform) {
    if (!MSP_Core.needsLocalSync(row, platform)) return;
    var state = MSP_Core.parseState(row[platform + '_state'], row.post_id, platform);
    plans.push(actionPlan_(row, platform, state, 'LOCAL_SYNC_DONE', 0, -1, null, state.signature || ''));
  });
}

function planImageActions_(plans, row, resolved, signature, due, now, config) {
  var facebookState = MSP_Core.parseState(row.facebook_state, row.post_id, 'facebook');
  var instagramState = MSP_Core.parseState(row.instagram_state, row.post_id, 'instagram');
  var facebookOpen = !MSP_Core.platformFinished(row, 'facebook');
  var instagramOpen = !MSP_Core.platformFinished(row, 'instagram');
  var facebookStatus = MSP_Core.text(row.facebook_status).toUpperCase();
  var needed = resolved.media.length;

  // An intent already persisted must be reconciled or reviewed before any
  // shared Page-photo staging or Instagram child creation can continue.
  if (facebookState.pending_action || instagramState.pending_action || facebookState.step === 'VERIFY' || instagramState.step === 'VERIFY') return;

  if (facebookState.signature && facebookState.signature !== signature) {
    var signaturePlatform = facebookOpen ? 'facebook' : 'instagram';
    var signatureState = signaturePlatform === 'facebook' ? facebookState : instagramState;
    plans.push(actionPlan_(row, signaturePlatform, signatureState, 'LOCAL_REVIEW', due, 1, resolved, signature, { message: 'Caption or image media changed after preparation. Review the staged Meta media before resetting.' }));
    return;
  }
  if (instagramOpen && instagramState.signature && instagramState.signature !== signature) {
    plans.push(actionPlan_(row, 'instagram', instagramState, 'LOCAL_REVIEW', due, 1, resolved, signature, { message: 'Caption or image media changed after preparation. Review the existing Instagram containers before resetting.' }));
    return;
  }

  var stagingAllowed = (facebookOpen || (facebookStatus === 'DISABLED' && instagramOpen)) && ['REVIEW', 'MISSED'].indexOf(facebookState.step) === -1;
  if (stagingAllowed && (facebookState.photo_ids || []).length < needed) {
    plans.push(actionPlan_(row, 'facebook', facebookState, 'STAGE_PHOTO', due, 3, resolved, signature, { index: (facebookState.photo_ids || []).length }));
    return;
  }
  if (!stagingAllowed && instagramOpen && (facebookState.photo_ids || []).length < needed) {
    plans.push(actionPlan_(row, 'instagram', instagramState, 'LOCAL_REVIEW', due, 1, resolved, signature, { message: 'Instagram needs staged Page photos, but the Facebook staging state is unavailable. Inspect both platform states before resetting.' }));
    return;
  }
  if (facebookOpen && now >= due) {
    plans.push(actionPlan_(row, 'facebook', facebookState, 'FB_IMAGE_PUBLISH', due, 1, resolved, signature));
  }
  if (!instagramOpen) return;
  var children = instagramState.children || [];
  if (children.length < needed) {
    plans.push(actionPlan_(row, 'instagram', instagramState, 'IG_IMAGE_CREATE', due, 3, resolved, signature, { index: children.length, photo_id: facebookState.photo_ids[children.length] }));
    return;
  }
  var ready = instagramState.ready_children || [];
  var uncheckedIndex = children.findIndex(function (id) { return ready.indexOf(id) === -1; });
  if (uncheckedIndex !== -1) {
    plans.push(actionPlan_(row, 'instagram', instagramState, 'IG_CHILD_STATUS', due, 2, resolved, signature, { child_id: children[uncheckedIndex], index: uncheckedIndex }));
    return;
  }
  if (!instagramState.remote_id) {
    plans.push(actionPlan_(row, 'instagram', instagramState, row.normalized_format === 'IMAGE' ? 'IG_SINGLE_READY' : 'IG_PARENT_CREATE', due, 3, resolved, signature));
    return;
  }
  if (instagramState.step !== 'READY') {
    plans.push(actionPlan_(row, 'instagram', instagramState, 'IG_CONTAINER_STATUS', due, 2, resolved, signature));
    return;
  }
  if (now >= due) plans.push(actionPlan_(row, 'instagram', instagramState, 'IG_PUBLISH', due, 1, resolved, signature));
}

function planReelActions_(plans, row, resolved, signature, due, now) {
  ['facebook', 'instagram'].forEach(function (platform) {
    if (MSP_Core.platformFinished(row, platform)) return;
    var state = MSP_Core.parseState(row[platform + '_state'], row.post_id, platform);
    if (state.pending_action) return;
    if (state.signature && state.signature !== signature) {
      plans.push(actionPlan_(row, platform, state, 'LOCAL_REVIEW', due, 1, resolved, signature, { message: 'Caption, video, format, or cover changed after preparation. Review the existing upload before resetting.' }));
      return;
    }
    if (platform === 'instagram' && resolved.cover && !state.cover_photo_id && state.step === 'NEW') {
      plans.push(actionPlan_(row, platform, state, 'IG_COVER_STAGE', due, 3, resolved, signature));
      return;
    }
    var action = '';
    if (state.step === 'NEW') action = platform === 'facebook' ? 'FB_REEL_CREATE' : 'IG_REEL_CREATE';
    else if (state.step === 'UPLOAD') action = 'VIDEO_UPLOAD';
    else if (state.step === 'PROCESS') action = platform === 'facebook' ? 'FB_REEL_STATUS' : 'IG_REEL_STATUS';
    else if (state.step === 'READY' && now >= due) action = platform === 'facebook' ? 'FB_REEL_PUBLISH' : 'IG_PUBLISH';
    if (action) plans.push(actionPlan_(row, platform, state, action, due, action.indexOf('PUBLISH') !== -1 ? 1 : (action.indexOf('STATUS') !== -1 ? 2 : 3), resolved, signature));
  });
}

function planNextAction_(values, config, rootFolder, now, cache, seen) {
  var rows = MSP_Core.parseRows(values);
  var plans = [];
  rows.forEach(function (row) { addConsistencyPlans_(plans, row); });
  rows.forEach(function (row) { addReconciliationPlans_(plans, row, now); });
  if (plans.length) {
    plans.sort(sortPlans_);
    if (!seen) return plans[0];
    var reconciliation = plans.find(function (plan) { return !seen.has(planKey_(plan)); });
    if (reconciliation) return reconciliation;
    // All recovery work has already been attempted in this invocation. Keep
    // planning so an unrelated due row is not starved until the next trigger.
    plans = [];
  }

  rows.forEach(function (row) {
    if (!MSP_Core.isApproved(row)) return;
    if (MSP_Core.platformFinished(row, 'facebook') && MSP_Core.platformFinished(row, 'instagram')) return;
    var issues = MSP_Core.staticRowIssues(row, config.time_zone, localToEpoch_);
    var parsed = MSP_Core.parsePublishAt(row.publish_at, config.time_zone, localToEpoch_);
    var due = parsed.ok ? parsed.epoch : 0;
    if (issues.length) {
      ['facebook', 'instagram'].some(function (platform) {
        if (MSP_Core.platformFinished(row, platform)) return false;
        var state = MSP_Core.parseState(row[platform + '_state'], row.post_id, platform);
        plans.push(actionPlan_(row, platform, state, 'LOCAL_REVIEW', due, 4, null, state.signature || '', { message: issues.join(' ') }));
        return true;
      });
      return;
    }
    if (now < due - config.prepare_minutes * 60000) return;
    if (now > due + config.max_late_minutes * 60000) {
      ['facebook', 'instagram'].forEach(function (platform) {
        if (!MSP_Core.platformFinished(row, platform)) {
          plans.push(actionPlan_(row, platform, MSP_Core.parseState(row[platform + '_state'], row.post_id, platform), 'LOCAL_MISSED', due, 4, null, '', {}));
        }
      });
      return;
    }
    var resolved;
    try { resolved = resolveRowMedia_(rootFolder, row, config, cache); }
    catch (error) {
      ['facebook', 'instagram'].some(function (platform) {
        if (MSP_Core.platformFinished(row, platform)) return false;
        plans.push(actionPlan_(row, platform, MSP_Core.parseState(row[platform + '_state'], row.post_id, platform), 'LOCAL_REVIEW', due, 4, null, '', { message: error.message }));
        return true;
      });
      return;
    }
    var signature = mediaSignature_(row, resolved);
    if (row.normalized_format === 'REEL') planReelActions_(plans, row, resolved, signature, due, now);
    else planImageActions_(plans, row, resolved, signature, due, now, config);
  });

  plans.sort(sortPlans_);
  if (!seen) return plans[0] || null;
  return plans.find(function (plan) { return !seen.has(planKey_(plan)); }) || null;
}

function sortPlans_(left, right) {
  return left.priority - right.priority || left.due - right.due || String(left.row.post_id).localeCompare(String(right.row.post_id)) || left.platform.localeCompare(right.platform);
}

function planKey_(plan) {
  return [plan.row.post_id, plan.platform, plan.action, plan.index == null ? '' : plan.index, plan.child_id || ''].join(':');
}

function mutationAction_(action) {
  return ['STAGE_PHOTO', 'FB_IMAGE_PUBLISH', 'IG_IMAGE_CREATE', 'IG_PARENT_CREATE', 'IG_PUBLISH', 'IG_COVER_STAGE', 'FB_REEL_CREATE', 'IG_REEL_CREATE', 'VIDEO_UPLOAD', 'FB_REEL_PUBLISH'].indexOf(action) !== -1;
}

function completeState_(sheet, plan, claimed, next, error, publishedId) {
  var current = mutationAction_(plan.action) ? assertClaim_(sheet, plan.row.post_id, plan.platform, claimed.operation_id) : findRow_(sheet, plan.row.post_id);
  delete next.pending_action;
  delete next.pending_since;
  next.updated_at = new Date().toISOString();
  if (error) next.last_error = error;
  else delete next.last_error;
  var visible = String(current[plan.platform + '_status'] || '').toUpperCase() === 'DISABLED' ? 'DISABLED' : statusForStep_(next.step);
  writePlatformState_(sheet, current, plan.platform, next, visible, error || '', publishedId || '');
}

function executeAction_(sheet, config, plan) {
  var action = plan.action;
  var state = Object.assign({}, plan.state);
  if (action === 'LOCAL_REVIEW' || action === 'LOCAL_MISSED' || action === 'LOCAL_SYNC_DONE') {
    var localRow = findRow_(sheet, plan.row.post_id);
    if (!materialFieldsMatch_(plan.row, localRow, plan.platform)) throw new Error('The queue row changed while planning. No state change was made.');
    if (action === 'LOCAL_REVIEW') reviewState_(sheet, localRow, plan.platform, state, plan.message || 'This row needs review.');
    else if (action === 'LOCAL_MISSED') missedState_(sheet, localRow, plan.platform, state);
    else {
      delete state.last_error;
      state.updated_at = new Date().toISOString();
      writePlatformState_(sheet, localRow, plan.platform, state, 'PUBLISHED', '', state.published_id || '');
    }
    return;
  }
  if (action === 'IG_SINGLE_READY') {
    state.remote_id = state.children[0]; state.step = 'READY'; state.signature = plan.signature;
    completeState_(sheet, plan, state, state, '', ''); return;
  }

  var claim = mutationAction_(action) ? claimMutation_(sheet, plan) : { row: findRow_(sheet, plan.row.post_id), state: state };
  var claimed = claim.state;
  var next = Object.assign({}, claimed);
  var response;
  var body;
  var id;
  try {
    if (action === 'STAGE_PHOTO') {
      response = metaRequest_(config.page_id + '/photos', 'POST', {
        published: 'false', alt_text_custom: MSP_Core.text(plan.row.topic) || String(plan.row.post_id)
      }, verifiedBlob_(plan.resolved.media[plan.index], 'image'));
      if (!response.ok) throw new Error(safeMetaError_(response, 'Meta image staging failed'));
      id = String(response.body.id || '');
      if (!/^\d+$/.test(id)) throw new Error('Meta did not return a staged photo ID.');
      next.photo_ids = (next.photo_ids || []).concat([id]);
      next.step = next.photo_ids.length === plan.resolved.media.length ? 'READY' : 'NEW';
    } else if (action === 'FB_IMAGE_PUBLISH') {
      var feedParams = { message: plan.row.caption };
      (next.photo_ids || []).forEach(function (photoId, index) {
        feedParams['attached_media[' + index + ']'] = JSON.stringify({ media_fbid: photoId });
      });
      response = metaRequest_(config.page_id + '/feed', 'POST', feedParams);
      if (!response.ok) throw new Error(safeMetaError_(response, 'Facebook image publication failed'));
      id = String(response.body.id || '');
      if (!/^\d+(?:_\d+)?$/.test(id)) throw new Error('Meta did not return a Facebook post ID.');
      next.step = 'DONE'; next.published_id = id; next.published_at = new Date().toISOString();
    } else if (action === 'IG_IMAGE_CREATE') {
      var imageParams = {
        image_url: metaImageUrl_(plan.photo_id),
        alt_text: MSP_Core.text(plan.row.topic) || String(plan.row.post_id)
      };
      if (plan.row.normalized_format === 'CAROUSEL') imageParams.is_carousel_item = 'true';
      else imageParams.caption = plan.row.caption;
      response = metaRequest_(config.instagram_id + '/media', 'POST', imageParams);
      if (!response.ok) throw new Error(safeMetaError_(response, 'Instagram image container creation failed'));
      id = String(response.body.id || '');
      if (!/^\d+$/.test(id)) throw new Error('Meta did not return an Instagram image container ID.');
      next.children = (next.children || []).concat([id]); next.step = 'PROCESS';
    } else if (action === 'IG_CHILD_STATUS') {
      response = metaRequest_(String(plan.child_id), 'GET', { fields: 'status_code' });
      if (!response.ok) throw new Error(safeMetaError_(response, 'Instagram child status check failed'));
      delete next.transport_error_count;
      body = response.body || {};
      if (body.status_code === 'FINISHED') {
        next.ready_children = (next.ready_children || []).concat([String(plan.child_id)]); next.poll_count = 0;
      } else if (['ERROR', 'EXPIRED'].indexOf(body.status_code) !== -1) {
        throw new Error('Instagram image container returned ' + body.status_code + '.');
      } else if ((next.poll_count = Number(next.poll_count || 0) + 1) > 12) {
        throw new Error('Instagram image preparation exceeded twelve checks.');
      }
    } else if (action === 'IG_PARENT_CREATE') {
      response = metaRequest_(config.instagram_id + '/media', 'POST', {
        media_type: 'CAROUSEL', children: (next.children || []).join(','), caption: plan.row.caption
      });
      if (!response.ok) throw new Error(safeMetaError_(response, 'Instagram carousel container creation failed'));
      id = String(response.body.id || '');
      if (!/^\d+$/.test(id)) throw new Error('Meta did not return an Instagram carousel container ID.');
      next.remote_id = id; next.step = 'PROCESS'; next.poll_count = 0;
    } else if (action === 'IG_CONTAINER_STATUS' || action === 'IG_REEL_STATUS' || action === 'IG_VERIFY') {
      response = metaRequest_(String(next.remote_id), 'GET', { fields: 'status_code' });
      if (!response.ok) throw new Error(safeMetaError_(response, 'Instagram status check failed'));
      delete next.transport_error_count;
      body = response.body || {};
      if (body.status_code === 'PUBLISHED') {
        next.step = 'DONE'; next.published_at = next.published_at || new Date().toISOString();
        if (next.published_id) id = next.published_id;
        else next.published_id_unavailable = true;
      } else if (action !== 'IG_VERIFY' && body.status_code === 'FINISHED') {
        next.step = 'READY'; next.poll_count = 0;
      } else if (['ERROR', 'EXPIRED'].indexOf(body.status_code) !== -1) {
        throw new Error('Instagram container returned ' + body.status_code + '.');
      } else if ((next.poll_count = Number(next.poll_count || 0) + 1) > 12) {
        throw new Error('Instagram did not confirm the expected state within twelve checks.');
      } else if (action === 'IG_VERIFY') {
        next.step = 'VERIFY';
      }
    } else if (action === 'IG_PUBLISH') {
      response = metaRequest_(config.instagram_id + '/media_publish', 'POST', { creation_id: next.remote_id });
      if (!response.ok) throw new Error(safeMetaError_(response, 'Instagram publication request failed'));
      id = String(response.body.id || '');
      if (!/^\d+$/.test(id)) throw new Error('Meta did not return an Instagram media ID.');
      next.step = 'DONE'; next.published_id = id; next.published_at = new Date().toISOString();
    } else if (action === 'IG_COVER_STAGE') {
      response = metaRequest_(config.page_id + '/photos', 'POST', { published: 'false' }, verifiedBlob_(plan.resolved.cover, 'image'));
      if (!response.ok) throw new Error(safeMetaError_(response, 'Instagram Reel cover staging failed'));
      id = String(response.body.id || '');
      if (!/^\d+$/.test(id)) throw new Error('Meta did not return a staged cover photo ID.');
      next.cover_photo_id = id; next.step = 'NEW';
    } else if (action === 'FB_REEL_CREATE') {
      response = metaRequest_(config.page_id + '/video_reels', 'POST', { upload_phase: 'start' });
      if (!response.ok) throw new Error(safeMetaError_(response, 'Facebook Reel upload creation failed'));
      id = String(response.body.video_id || '');
      if (!/^\d+$/.test(id) || !validUploadUrl_(response.body.upload_url)) throw new Error('Meta did not return a valid Facebook video ID and upload URL.');
      next.remote_id = id; next.upload_url = String(response.body.upload_url); next.step = 'UPLOAD';
    } else if (action === 'IG_REEL_CREATE') {
      var reelParams = { media_type: 'REELS', upload_type: 'resumable', caption: plan.row.caption, share_to_feed: 'true' };
      if (next.cover_photo_id) reelParams.cover_url = metaImageUrl_(next.cover_photo_id);
      else reelParams.thumb_offset = '1000';
      response = metaRequest_(config.instagram_id + '/media', 'POST', reelParams);
      if (!response.ok) throw new Error(safeMetaError_(response, 'Instagram Reel container creation failed'));
      id = String(response.body.id || '');
      if (!/^\d+$/.test(id) || !validUploadUrl_(response.body.uri)) throw new Error('Meta did not return a valid Instagram Reel container ID and upload URI.');
      next.remote_id = id;
      next.upload_url = String(response.body.uri);
      next.step = 'UPLOAD';
    } else if (action === 'VIDEO_UPLOAD') {
      response = videoUpload_(plan.resolved.media[0], next.upload_url);
      if (!response.ok || response.body.success !== true) throw new Error(safeMetaError_(response, 'Video upload failed or returned an uncertain result'));
      next.step = plan.platform === 'facebook' ? 'READY' : 'PROCESS'; next.poll_count = 0;
    } else if (action === 'FB_REEL_PUBLISH') {
      response = metaRequest_(config.page_id + '/video_reels', 'POST', {
        upload_phase: 'finish', video_id: next.remote_id, video_state: 'PUBLISHED', description: plan.row.caption
      });
      if (!response.ok || response.body.success !== true) throw new Error(safeMetaError_(response, 'Facebook Reel publication request failed'));
      next.step = 'VERIFY'; next.poll_count = 0; next.publish_accepted_at = new Date().toISOString();
    } else if (action === 'FB_REEL_STATUS' || action === 'FB_REEL_VERIFY') {
      response = metaRequest_(String(next.remote_id), 'GET', { fields: 'status' });
      if (!response.ok) throw new Error(safeMetaError_(response, 'Facebook Reel status check failed'));
      delete next.transport_error_count;
      var status = response.body.status || {};
      var phase = status.publishing_phase || {};
      var failed = [status.uploading_phase, status.processing_phase, phase].some(function (item) {
        return item && (item.error || item.status === 'error' || item.status === 'failed');
      });
      if (phase.status === 'complete') {
        next.step = 'DONE'; next.published_id = String(next.remote_id); next.published_at = new Date().toISOString(); id = next.published_id;
      } else if (failed) {
        throw new Error('Facebook reported an upload, processing, or publishing error.');
      } else if ((next.poll_count = Number(next.poll_count || 0) + 1) > 12) {
        throw new Error('Facebook did not confirm publication within twelve checks.');
      } else if (action === 'FB_REEL_STATUS') {
        next.step = 'PROCESS';
      } else {
        next.step = 'VERIFY';
      }
    } else {
      throw new Error('Unsupported planned action: ' + action);
    }
  } catch (error) {
    var message = String(error && error.message || 'The operation failed.');
    var pollActions = ['IG_CHILD_STATUS', 'IG_CONTAINER_STATUS', 'IG_REEL_STATUS', 'IG_VERIFY', 'FB_REEL_STATUS', 'FB_REEL_VERIFY'];
    var definitiveRemoteFailure = /returned (?:ERROR|EXPIRED)|reported an upload, processing, or publishing error|exceeded twelve checks|within twelve checks/i.test(message);
    if (pollActions.indexOf(action) !== -1 && !definitiveRemoteFailure) {
      next.transport_error_count = Number(next.transport_error_count || 0) + 1;
      if (next.transport_error_count <= 4) {
        if (action.indexOf('VERIFY') !== -1) next.step = 'VERIFY';
        else next.step = 'PROCESS';
        completeState_(sheet, plan, claimed, next, message, '');
        return;
      }
    }
    var publishAction = action === 'IG_PUBLISH' || action === 'FB_REEL_PUBLISH';
    var ambiguousPublishFailure = publishAction && (!response || response.ok || Number(response.statusCode) === 0 || Number(response.statusCode) >= 500);
    if (ambiguousPublishFailure) {
      next.step = 'VERIFY'; next.pending_action = action; next.pending_since = claimed.pending_since; next.last_error = message;
      var uncertainRow = mutationAction_(action) ? assertClaim_(sheet, plan.row.post_id, plan.platform, claimed.operation_id) : findRow_(sheet, plan.row.post_id);
      writePlatformState_(sheet, uncertainRow, plan.platform, next, 'PUBLISHING', 'Publish result is uncertain. The publisher will verify the existing remote object before any retry.');
      return;
    }
    reviewState_(sheet, findRow_(sheet, plan.row.post_id), plan.platform, next, message);
    return;
  }
  completeState_(sheet, plan, claimed, next, '', id || next.published_id || '');
}

function validationResult_() {
  var config = config_();
  var sheet = queueSheet_(config);
  var values = readRows_(sheet);
  var base = MSP_Core.validateApproved(values, config.time_zone, localToEpoch_);
  var problems = base.problems.slice();
  var problemPosts = new Set(problems.map(function (problem) { return problem.post_id; }));
  var root = DriveApp.getFolderById(config.drive_folder_id);
  var cache = Object.create(null);
  base.rows.filter(function (row) { return MSP_Core.isApproved(row) && !problemPosts.has(String(row.post_id)); }).forEach(function (row) {
    try {
      ['facebook', 'instagram'].forEach(function (platform) {
        var status = MSP_Core.text(row[platform + '_status']).toUpperCase();
        var outputId = MSP_Core.text(row[platform + '_post_id']);
        var state = MSP_Core.parseState(row[platform + '_state'], row.post_id, platform);
        if (status === 'PUBLISHED' && !outputId && !state.published_id_unavailable) throw new Error(platform + ' is PUBLISHED but its output ID is blank.');
        if (status === 'PUBLISHED' && ['DONE', 'VERIFY'].indexOf(state.step) === -1) {
          throw new Error(platform + ' is PUBLISHED but its saved state is ' + state.step + '. Inspect the public profile and repair the row before continuing.');
        }
      });
      if (!(MSP_Core.platformFinished(row, 'facebook') && MSP_Core.platformFinished(row, 'instagram'))) {
        resolveRowMedia_(root, row, config, cache);
      }
    } catch (error) {
      problems.push({ post_id: String(row.post_id), row_number: row.row_number, message: error.message });
      problemPosts.add(String(row.post_id));
    }
  });
  return { approved: base.approved, valid: base.approved - problemPosts.size, problems: problems };
}

function showReport_(title, lines) {
  var escaped = String(lines).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var html = '<!doctype html><meta charset="utf-8"><style>body{font:14px/1.5 Arial,sans-serif;padding:18px;color:#17202a}h2{margin:0 0 12px}pre{white-space:pre-wrap;font:13px/1.55 ui-monospace,Consolas,monospace;background:#f6f8fa;padding:14px;border-radius:8px}</style><h2>' + String(title).replace(/</g, '&lt;') + '</h2><pre>' + escaped + '</pre>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(650).setHeight(520), title);
}

function validateApprovedRows() {
  var result = validationResult_();
  var lines = ['Approved rows: ' + result.approved, 'Valid: ' + result.valid, 'Needs attention: ' + (result.approved - result.valid), ''];
  if (!result.problems.length) lines.push('All approved rows passed local validation.');
  else {
    result.problems.slice(0, 20).forEach(function (problem) { lines.push(problem.post_id + ' (row ' + problem.row_number + '): ' + problem.message); });
    if (result.problems.length > 20) lines.push('', 'Plus ' + (result.problems.length - 20) + ' more issue(s).');
  }
  lines.push('', 'Validation reads Drive and the sheet only. It does not upload or publish.');
  showReport_('Approved-row validation', lines.join('\n'));
}

function previewNextAction() {
  var config = config_();
  config.live = false;
  var sheet = queueSheet_(config);
  var values = readRows_(sheet);
  var root = DriveApp.getFolderById(config.drive_folder_id);
  var plan = planNextAction_(values, config, root, Date.now(), Object.create(null), null);
  if (!plan) {
    showReport_('Posting preview', 'No action is due within the next ' + config.prepare_minutes + ' minutes. Only APPROVED rows can become eligible.');
    return;
  }
  var lines = [
    plan.row.post_id + ' · ' + plan.platform,
    'Next action: ' + plan.action,
    'Format: ' + plan.row.format,
    'Scheduled: ' + plan.row.publish_at
  ];
  if (plan.message) lines.push('Issue: ' + plan.message);
  lines.push('', 'Preview only. No media was uploaded, published, or changed.');
  showReport_('Posting preview', lines.join('\n'));
}

function reserveRuntimeBudget_(properties, now) {
  var budget;
  try { budget = JSON.parse(properties.getProperty('MSP_BUDGET') || 'null'); } catch (error) {}
  if (!budget || !Number.isFinite(budget.used_ms) || now - budget.started_at >= 86400000) budget = { started_at: now, used_ms: 0 };
  if (budget.used_ms + 360000 > MSP.dailyRuntimeBudgetMs) return null;
  budget.used_ms += 360000;
  properties.setProperty('MSP_BUDGET', JSON.stringify(budget));
  return budget;
}

function hasPotentialWork_(values) {
  return MSP_Core.parseRows(values).some(function (row) {
    return ['facebook', 'instagram'].some(function (platform) {
      return MSP_Core.needsLocalSync(row, platform) || MSP_Core.needsReconciliation(row, platform) || (MSP_Core.isApproved(row) && !MSP_Core.platformFinished(row, platform));
    });
  });
}

function postingTick(event) {
  var properties = scriptStore_();
  if (properties.getProperty('MSP_ENABLED') !== 'true') return;
  if (!event || String(event.triggerUid) !== properties.getProperty('MSP_TRIGGER_ID')) throw new Error('Live posting runs only from the installed trigger. Use Posting preview for manual checks.');
  if (properties.getProperty('MSP_OWNER') !== ownerKey_()) throw new Error('This trigger is not owned by the connected account.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1)) return;
  var started = Date.now();
  var budget;
  var completed = 0;
  try {
    budget = reserveRuntimeBudget_(properties, started);
    if (!budget) {
      properties.setProperty('MSP_LAST_STATUS', 'Paused work for the 24-hour runtime budget. Checks resume after renewal.');
      return;
    }
    var config = config_();
    var sheet = queueSheet_(config);
    var values = readRows_(sheet);
    if (!hasPotentialWork_(values)) {
      properties.setProperty('MSP_LAST_STATUS', 'No approved or recoverable work is waiting.');
      return;
    }
    var root = DriveApp.getFolderById(config.drive_folder_id);
    var cache = Object.create(null);
    var seen = new Set();
    while (completed < MSP.maxOperationsPerRun && Date.now() - started < MSP.maxRunMs && properties.getProperty('MSP_ENABLED') === 'true') {
      var plan = planNextAction_(readRows_(sheet), config, root, Date.now(), cache, seen);
      if (!plan) break;
      executeAction_(sheet, config, plan);
      seen.add(planKey_(plan));
      completed++;
    }
    properties.setProperty('MSP_LAST_STATUS', completed ? 'Completed ' + completed + ' action(s). Review platform statuses and last_error in the queue.' : 'No action is due yet.');
  } catch (error) {
    properties.setProperty('MSP_LAST_STATUS', 'A check stopped. Inspect the queue and Apps Script execution before resetting any state.');
    throw new Error('Meta Publisher check stopped. Inspect queue status, saved state, media access, and permissions. Do not blindly replay publishing requests.');
  } finally {
    if (budget) {
      budget.used_ms = Math.max(0, budget.used_ms - 360000 + (Date.now() - started));
      properties.setProperty('MSP_BUDGET', JSON.stringify(budget));
    }
    properties.setProperty('MSP_LAST_RUN', new Date().toISOString());
    lock.releaseLock();
  }
}
