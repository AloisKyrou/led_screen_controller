'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PanelGif = require('../public/panel-gif');

function validMetadata(gif) {
  return gif && /^[a-f0-9]{64}$/.test(gif.hash) &&
    Number.isInteger(gif.frameCount) && gif.frameCount > 0 && gif.frameCount <= PanelGif.limits.maxFrames &&
    Number.isInteger(gif.durationMs) && gif.durationMs >= 20 && gif.durationMs <= PanelGif.limits.maxDurationMs &&
    Number.isInteger(gif.byteLength) && gif.byteLength > 0 && gif.byteLength <= PanelGif.limits.maxBytes;
}

function validateUpload(data) {
  if (typeof data !== 'string' || !data.length || data.length > Math.ceil(PanelGif.limits.maxBytes / 3) * 4 ||
      data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error('Fichier GIF invalide ou supérieur à 512 Ko.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) throw new Error('Encodage GIF invalide.');
  const decoded = PanelGif.decode(bytes);
  return { bytes, metadata: {
    hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    frameCount: decoded.frames.length,
    durationMs: decoded.totalDurationMs,
    byteLength: bytes.length,
  } };
}

function createPublicGifFiles(directory) {
  const filePath = gif => {
    if (!validMetadata(gif)) throw new Error('GIF introuvable.');
    return path.join(directory, `${gif.hash}.gif`);
  };
  return {
    save(upload) {
      fs.mkdirSync(directory, { recursive: true });
      const target = filePath(upload.metadata);
      const temporary = `${target}.tmp`;
      fs.writeFileSync(temporary, upload.bytes);
      fs.renameSync(temporary, target);
    },
    read(gif) { return fs.readFileSync(filePath(gif)); },
    prune(items) {
      if (!fs.existsSync(directory)) return;
      const keep = new Set(items.filter(item => validMetadata(item.gif)).map(item => `${item.gif.hash}.gif`));
      for (const name of fs.readdirSync(directory)) {
        if (/^[a-f0-9]{64}\.gif(?:\.tmp)?$/.test(name) && !keep.has(name)) {
          fs.unlinkSync(path.join(directory, name));
        }
      }
    },
  };
}

module.exports = { validateUpload, validMetadata, createPublicGifFiles };
