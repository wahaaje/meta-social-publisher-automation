/* Safe, relative-path-only access to campaign media in Google Drive. */
function oneFromIterator_(iterator, kind, name) {
  if (!iterator.hasNext()) throw new Error(kind + ' was not found: ' + name);
  var first = iterator.next();
  if (iterator.hasNext()) throw new Error('More than one ' + kind.toLowerCase() + ' matches: ' + name);
  return first;
}

function resolveRelativeFile_(rootFolder, relativePath) {
  var safePath = MSP_Core.safeRelativePath(relativePath);
  if (!safePath) throw new Error('Unsafe or empty Drive path: ' + String(relativePath || ''));
  var parts = safePath.split('/');
  var folder = rootFolder;
  for (var index = 0; index < parts.length - 1; index++) {
    folder = oneFromIterator_(folder.getFoldersByName(parts[index]), 'Folder', parts.slice(0, index + 1).join('/'));
  }
  return oneFromIterator_(folder.getFilesByName(parts[parts.length - 1]), 'File', safePath);
}

function snapshotFile_(rootFolder, relativePath, cache) {
  var path = MSP_Core.safeRelativePath(relativePath);
  if (!path) throw new Error('Unsafe or empty Drive path.');
  if (cache && cache[path]) return cache[path];
  var file = resolveRelativeFile_(rootFolder, path);
  var snapshot = {
    id: file.getId(),
    path: path,
    name: file.getName(),
    size: Number(file.getSize()),
    mimeType: file.getMimeType(),
    modifiedTime: file.getLastUpdated().toISOString()
  };
  if (cache) cache[path] = snapshot;
  return snapshot;
}

function validateSnapshot_(snapshot, kind, config) {
  if (!snapshot || !/^[-A-Za-z0-9_]+$/.test(String(snapshot.id || ''))) throw new Error('Drive returned an invalid file identifier.');
  if (!Number.isFinite(snapshot.size) || snapshot.size < 32) throw new Error('Media file is empty or its size could not be read: ' + snapshot.path);
  if (kind === 'image') {
    if (!/\.jpe?g$/i.test(snapshot.path) || snapshot.mimeType !== 'image/jpeg') throw new Error('Use a JPEG image: ' + snapshot.path);
    if (snapshot.size > config.max_image_bytes) throw new Error('Image exceeds the configured size limit: ' + snapshot.path);
  } else if (kind === 'video') {
    if (!/\.mp4$/i.test(snapshot.path) || snapshot.mimeType !== 'video/mp4') throw new Error('Use an MP4 video: ' + snapshot.path);
    if (snapshot.size > config.max_video_bytes) throw new Error('Video exceeds the configured size limit: ' + snapshot.path);
  }
  return snapshot;
}

function resolveRowMedia_(rootFolder, row, config, cache) {
  var kind = row.normalized_format === 'REEL' ? 'video' : 'image';
  var media = (row.media_paths || []).map(function (path) {
    return validateSnapshot_(snapshotFile_(rootFolder, path, cache), kind, config);
  });
  var cover = null;
  if (MSP_Core.text(row.reel_cover_filename)) {
    cover = validateSnapshot_(snapshotFile_(rootFolder, row.reel_cover_filename, cache), 'image', config);
  }
  return { media: media, cover: cover };
}

function verifiedBlob_(snapshot, kind) {
  var file = DriveApp.getFileById(snapshot.id);
  if (file.getName() !== snapshot.name || Number(file.getSize()) !== Number(snapshot.size) || file.getLastUpdated().toISOString() !== snapshot.modifiedTime) {
    throw new Error('Drive media changed after preparation: ' + snapshot.path);
  }
  var blob = file.getBlob();
  var bytes = blob.getBytes();
  if (bytes.length !== Number(snapshot.size)) throw new Error('Drive returned a different media size: ' + snapshot.path);
  if (kind === 'image') {
    if (bytes.length < 3 || (bytes[0] & 255) !== 255 || (bytes[1] & 255) !== 216 || (bytes[2] & 255) !== 255) {
      throw new Error('JPEG signature validation failed: ' + snapshot.path);
    }
  } else if (kind === 'video') {
    if (bytes.length < 12 || String.fromCharCode.apply(null, bytes.slice(4, 8)) !== 'ftyp') {
      throw new Error('MP4 signature validation failed: ' + snapshot.path);
    }
  }
  return blob;
}

function mediaSignature_(row, resolved) {
  var snapshots = resolved.media.map(function (file) {
    return [file.path, file.id, file.size, file.modifiedTime];
  });
  var cover = resolved.cover ? [resolved.cover.path, resolved.cover.id, resolved.cover.size, resolved.cover.modifiedTime] : null;
  return MSP_Core.signature(JSON.stringify([row.normalized_format, row.caption, row.publish_at, row.topic, snapshots, cover]));
}
