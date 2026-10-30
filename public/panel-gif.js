/* Shared, bounded GIF codec for the 60 × 15 panel. Works offline in Node and browsers.
 * Format: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 * Transparent pixels and disposal-to-background use the panel's black background.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelGif = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const limits = Object.freeze({ width: 60, height: 15, maxBytes: 512 * 1024, maxFrames: 120, maxDurationMs: 15000 });
  const FRAME_BYTES = limits.width * limits.height * 3;
  function check(ok, message = 'GIF endommagé ou incomplet.') {
    if (!ok) throw new Error(message);
  }

  // Strict LZW: every read and output is bounded; missing pixels/EOS are errors.
  function pixelsFromLzw(data, minimum, count) {
    check(minimum >= 2 && minimum <= 8);
    const clear = 1 << minimum;
    const end = clear + 1;
    let bits = minimum + 1, offset = 0, next = end + 1, previous = null;
    const dictionary = Array.from({ length: clear }, (_, i) => [i]);
    let written = 0, started = false;
    const pixels = new Uint8Array(count);
    while (offset + bits <= data.length * 8) {
      let code = 0;
      for (let bit = 0; bit < bits; bit++, offset++) {
        code |= ((data[offset >> 3] >> (offset & 7)) & 1) << bit;
      }
      if (code === clear) {
        dictionary.length = end + 1;
        next = end + 1;
        bits = minimum + 1;
        previous = null;
        started = true;
        continue;
      }
      check(started);
      if (code === end) {
        check(written === count);
        return pixels;
      }
      const sequence = code < next ? dictionary[code]
        : code === next && previous ? [...previous, previous[0]] : null;
      check(sequence && sequence.length && written + sequence.length <= count);
      pixels.set(sequence, written);
      written += sequence.length;
      if (previous && next < 4096) {
        dictionary[next++] = [...previous, sequence[0]];
        if (next === (1 << bits) && bits < 12) bits++;
      }
      previous = sequence;
    }
    throw new Error('GIF endommagé : données d’image incomplètes.');
  }

  function decode(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    check(bytes.length <= limits.maxBytes, 'Le GIF dépasse 512 Ko.');
    let pos = 0;
    function read(size) {
      check(pos + size <= bytes.length);
      const chunk = bytes.subarray(pos, pos + size);
      pos += size;
      return chunk;
    }
    const byte = () => read(1)[0];
    const word = () => { const b = read(2); return b[0] | (b[1] << 8); };
    function blocks() {
      const chunks = [];
      let length = 0, size;
      while ((size = byte())) { chunks.push(read(size)); length += size; }
      const result = new Uint8Array(length);
      let cursor = 0;
      chunks.forEach(chunk => { result.set(chunk, cursor); cursor += chunk.length; });
      return result;
    }
    const signature = String.fromCharCode(...read(6));
    check(signature === 'GIF87a' || signature === 'GIF89a', 'Choisis un vrai fichier GIF (.gif).');
    const width = word(), height = word();
    check(width === limits.width && height === limits.height,
      `Le GIF mesure ${width} × ${height}. Il doit mesurer exactement 60 × 15 pixels.`);
    const packed = byte();
    read(2); // Background index and aspect ratio; the panel background is black.
    const globalPalette = packed & 128 ? read(3 * (1 << ((packed & 7) + 1))) : null;
    const frames = [], durations = [];
    let canvas = new Uint8Array(FRAME_BYTES), control = null, totalDurationMs = 0;
    while (pos < bytes.length) {
      const marker = byte();
      if (marker === 0x3b) {
        check(!control);
        check(frames.length > 0, 'Ce GIF ne contient aucune image.');
        check(pos === bytes.length);
        return { width, height, frames, durations, totalDurationMs };
      }
      if (marker === 0x21) {
        const label = byte();
        if (label === 0xf9) {
          check(byte() === 4 && !control);
          const flags = byte(), delay = word(), transparent = byte();
          check(byte() === 0 && !(flags & 0xe0) && ((flags >> 2) & 7) <= 3);
          check(!(flags & 2), 'Les GIF qui attendent une interaction ne sont pas pris en charge.');
          control = { disposal: (flags >> 2) & 7, delay: Math.max(20, delay * 10 || 100),
            transparent: flags & 1 ? transparent : -1 };
        } else if (label === 0xff) {
          check(byte() === 11);
          read(11);
          blocks(); // Application metadata, including source loop counts.
        } else if (label === 0xfe) {
          blocks();
        } else {
          throw new Error('Ce type d’extension GIF n’est pas pris en charge. Exporte un GIF avec des images uniquement.');
        }
        continue;
      }
      check(marker === 0x2c);
      check(frames.length < limits.maxFrames, 'Maximum 120 images par GIF.');
      const left = word(), top = word(), w = word(), h = word(), flags = byte();
      check(w > 0 && h > 0 && left + w <= width && top + h <= height,
        'Une image du GIF dépasse la zone de 60 × 15 pixels.');
      check(!(flags & 0x18));
      const palette = flags & 128 ? read(3 * (1 << ((flags & 7) + 1))) : globalPalette;
      check(palette && palette.length);
      const gce = control || { disposal: 0, delay: 100, transparent: -1 };
      check(gce.transparent < palette.length / 3);
      totalDurationMs += gce.delay;
      check(totalDurationMs <= limits.maxDurationMs, 'Le GIF dépasse 15 secondes par boucle.');
      const minimum = byte();
      const pixels = pixelsFromLzw(blocks(), minimum, w * h);
      const restore = gce.disposal === 3 ? canvas.slice() : null;
      const rows = [];
      if (flags & 64) {
        for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
          for (let y = start; y < h; y += step) rows.push(y);
        }
      } else for (let y = 0; y < h; y++) rows.push(y);
      let source = 0;
      for (const y of rows) {
        for (let x = 0; x < w; x++) {
          const index = pixels[source++];
          check(index * 3 < palette.length);
          if (index !== gce.transparent) {
            canvas.set(palette.subarray(index * 3, index * 3 + 3), ((top + y) * width + left + x) * 3);
          }
        }
      }
      frames.push(canvas.slice());
      durations.push(gce.delay);
      if (gce.disposal === 2) {
        for (let y = top; y < top + h; y++) canvas.fill(0, (y * width + left) * 3, (y * width + left + w) * 3);
      } else if (restore) canvas = restore;
      control = null;
    }
    throw new Error('GIF incomplet : fin de fichier manquante.');
  }

  // A literal LZW encoder is deliberately small. Reset every 200 pixels keeps
  // codes at 9 bits; even 120 full frames stay well below the upload limit.
  // Local palettes preserve up to 256 exact RGB colors per frame.
  function encode(frames, durations) {
    check(Array.isArray(frames) && frames.length > 0 && frames.length <= limits.maxFrames, 'Prépare entre 1 et 120 images.');
    check(Array.isArray(durations) && durations.length === frames.length);
    let total = 0;
    const delays = durations.map(value => {
      check(Number.isFinite(value) && value >= 20);
      const delay = Math.max(2, Math.round(value / 10));
      total += delay * 10;
      return delay;
    });
    check(total <= limits.maxDurationMs, 'Le GIF dépasse 15 secondes par boucle.');
    const output = [];
    const word = value => output.push(value & 255, value >> 8);
    const text = value => { for (const c of value) output.push(c.charCodeAt(0)); };
    text('GIF89a'); word(limits.width); word(limits.height); output.push(0, 0, 0);
    output.push(0x21, 0xff, 11); text('NETSCAPE2.0'); output.push(3, 1, 0, 0, 0);
    frames.forEach((frame, frameIndex) => {
      check(frame instanceof Uint8Array && frame.length === FRAME_BYTES);
      const palette = [], lookup = new Map(), indices = [];
      for (let p = 0; p < frame.length; p += 3) {
        const color = (frame[p] << 16) | (frame[p + 1] << 8) | frame[p + 2];
        if (!lookup.has(color)) {
          check(lookup.size < 256, 'Maximum 256 couleurs différentes par image pour l’export.');
          lookup.set(color, lookup.size);
          palette.push(frame[p], frame[p + 1], frame[p + 2]);
        }
        indices.push(lookup.get(color));
      }
      output.push(0x21, 0xf9, 4, 4); word(delays[frameIndex]); output.push(0, 0, 0x2c);
      word(0); word(0); word(limits.width); word(limits.height); output.push(0x87);
      while (palette.length < 768) palette.push(0);
      output.push(...palette, 8);
      const compressed = [];
      let accumulator = 0, bitCount = 0;
      function code(value) {
        accumulator |= value << bitCount;
        bitCount += 9;
        while (bitCount >= 8) {
          compressed.push(accumulator & 255);
          accumulator >>>= 8;
          bitCount -= 8;
        }
      }
      indices.forEach((index, i) => { if (i % 200 === 0) code(256); code(index); });
      code(257);
      if (bitCount) compressed.push(accumulator & 255);
      for (let start = 0; start < compressed.length; start += 255) {
        const block = compressed.slice(start, start + 255);
        output.push(block.length, ...block);
      }
      output.push(0);
    });
    output.push(0x3b);
    return Uint8Array.from(output);
  }

  return { limits, decode, encode };
});
