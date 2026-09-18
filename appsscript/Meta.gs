/* Hardened Meta Graph API adapter. */
function parseMetaResponse_(response) {
  var body = {};
  try { body = JSON.parse(response.getContentText()); } catch (error) {}
  var statusCode = Number(response.getResponseCode());
  return { ok: statusCode >= 200 && statusCode < 300 && !body.error, statusCode: statusCode, body: body };
}

function allowedGraphResource_(resource) {
  return resource === 'me' || /^(?:\d+|\d+_\d+)(?:\/(?:photos|feed|video_reels|media|media_publish))?$/.test(resource);
}

function formBody_(parameters) {
  return Object.keys(parameters || {}).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(String(parameters[key]));
  }).join('&');
}

function metaRequest_(resource, method, parameters, blob, accessToken) {
  if (!allowedGraphResource_(resource)) throw new Error('Unsupported Meta Graph endpoint.');
  var verb = String(method || 'GET').toUpperCase();
  if (['GET', 'POST'].indexOf(verb) === -1) throw new Error('Unsupported Meta request method.');
  var token = accessToken || token_();
  var url = 'https://graph.facebook.com/' + MSP.apiVersion + '/' + resource;
  var options = {
    method: verb.toLowerCase(),
    headers: { Authorization: 'Bearer ' + token },
    followRedirects: false,
    muteHttpExceptions: true,
    timeoutSeconds: 90
  };
  if (verb === 'GET') {
    var query = formBody_(parameters || {});
    if (query) url += '?' + query;
  } else if (blob) {
    options.payload = Object.assign({}, parameters || {}, { source: blob });
  } else {
    options.contentType = 'application/x-www-form-urlencoded';
    options.payload = formBody_(parameters || {});
  }
  try { return parseMetaResponse_(UrlFetchApp.fetch(url, options)); }
  catch (error) {
    return { ok: false, statusCode: 0, body: {}, localError: 'Meta request did not complete. Check the Apps Script execution and Page token.' };
  }
}

function safeMetaError_(response, fallback) {
  if (response && response.localError) return response.localError;
  var code = response && response.body && response.body.error && Number(response.body.error.code);
  var http = response && Number(response.statusCode);
  return fallback + (http ? ' (HTTP ' + http + ')' : '') + (code ? ' [code ' + code + ']' : '') + '.';
}

function metaImageUrl_(photoId) {
  var response = metaRequest_(String(photoId), 'GET', { fields: 'images' });
  if (!response.ok) throw new Error(safeMetaError_(response, 'Meta did not return the staged image'));
  var images = (response.body.images || []).filter(function (image) {
    return /^https:\/\/[^/]+\.(?:fbcdn\.net|fbsbx\.com)\//i.test(String(image.source || ''));
  });
  images.sort(function (left, right) { return Number(right.width) * Number(right.height) - Number(left.width) * Number(left.height); });
  if (!images.length) throw new Error('Meta did not return a usable image URL. Keep this row for review.');
  return images[0].source;
}

function validUploadUrl_(uploadUrl) {
  return /^https:\/\/rupload\.facebook\.com\/(?:video-upload|ig-api-upload)\/[A-Za-z0-9_./-]+(?:\?[A-Za-z0-9_.~%=&+:-]+)?$/.test(String(uploadUrl || ''));
}

function videoUpload_(snapshot, uploadUrl) {
  if (!validUploadUrl_(uploadUrl)) {
    return { ok: false, statusCode: 0, body: {}, localError: 'Unsupported Meta upload endpoint.' };
  }
  var blob;
  try { blob = verifiedBlob_(snapshot, 'video'); }
  catch (error) { return { ok: false, statusCode: 0, body: {}, localError: error.message }; }
  var bytes = blob.getBytes();
  var options = {
    method: 'post',
    contentType: 'application/octet-stream',
    payload: bytes,
    headers: {
      Authorization: 'OAuth ' + token_(),
      offset: '0',
      file_size: String(bytes.length)
    },
    followRedirects: false,
    muteHttpExceptions: true,
    timeoutSeconds: 90
  };
  try { return parseMetaResponse_(UrlFetchApp.fetch(uploadUrl, options)); }
  catch (error) {
    return { ok: false, statusCode: 0, body: {}, localError: 'Upload result is uncertain. Inspect Meta and this execution before resetting the row.' };
  }
}
