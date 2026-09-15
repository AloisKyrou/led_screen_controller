'use strict';
// 5×7 pixel bitmap font — minimal set for LED panels
// Each char is 5 bytes (one per column), bit 0 = TOP row

const CHAR_W = 5;
const CHAR_H = 7;

// Column bitmaps:  bit 0 = top pixel of that column
const GLYPHS = {
  ' ': [0x00,0x00,0x00,0x00,0x00],
  '!': [0x00,0x5F,0x00,0x00,0x00],
  '#': [0x14,0x7F,0x14,0x7F,0x14],
  '$': [0x24,0x2A,0x7F,0x2A,0x12],
  '%': [0x23,0x13,0x08,0x64,0x62],
  '&': [0x36,0x49,0x56,0x20,0x50],
  "'": [0x07,0x00,0x00,0x00,0x00],
  '(': [0x00,0x1C,0x22,0x41,0x00],
  ')': [0x00,0x41,0x22,0x1C,0x00],
  '*': [0x2A,0x1C,0x7F,0x1C,0x2A],
  '+': [0x08,0x08,0x3E,0x08,0x08],
  ',': [0x00,0x58,0x38,0x00,0x00],
  '-': [0x08,0x08,0x08,0x08,0x08],
  '.': [0x00,0x60,0x60,0x00,0x00],
  '/': [0x20,0x10,0x08,0x04,0x02],
  '0': [0x3E,0x51,0x49,0x45,0x3E],
  '1': [0x00,0x42,0x7F,0x40,0x00],
  '2': [0x72,0x49,0x49,0x49,0x46],
  '3': [0x21,0x41,0x49,0x4D,0x33],
  '4': [0x18,0x14,0x12,0x7F,0x10],
  '5': [0x27,0x45,0x45,0x45,0x39],
  '6': [0x3C,0x4A,0x49,0x49,0x31],
  '7': [0x01,0x71,0x09,0x05,0x03],
  '8': [0x36,0x49,0x49,0x49,0x36],
  '9': [0x06,0x49,0x49,0x29,0x1E],
  ':': [0x00,0x36,0x36,0x00,0x00],
  ';': [0x00,0x56,0x36,0x00,0x00],
  '<': [0x08,0x14,0x22,0x41,0x00],
  '=': [0x14,0x14,0x14,0x14,0x14],
  '>': [0x00,0x41,0x22,0x14,0x08],
  '?': [0x02,0x01,0x59,0x09,0x06],
  '@': [0x3E,0x41,0x5D,0x55,0x1E],
  'A': [0x7E,0x09,0x09,0x09,0x7E],
  'B': [0x7F,0x49,0x49,0x49,0x36],
  'C': [0x3E,0x41,0x41,0x41,0x22],
  'D': [0x7F,0x41,0x41,0x22,0x1C],
  'E': [0x7F,0x49,0x49,0x49,0x41],
  'F': [0x7F,0x09,0x09,0x09,0x01],
  'G': [0x3E,0x41,0x49,0x49,0x7A],
  'H': [0x7F,0x08,0x08,0x08,0x7F],
  'I': [0x00,0x41,0x7F,0x41,0x00],
  'J': [0x20,0x40,0x41,0x3F,0x01],
  'K': [0x7F,0x08,0x14,0x22,0x41],
  'L': [0x7F,0x40,0x40,0x40,0x40],
  'M': [0x7F,0x02,0x04,0x02,0x7F],
  'N': [0x7F,0x04,0x08,0x10,0x7F],
  'O': [0x3E,0x41,0x41,0x41,0x3E],
  'P': [0x7F,0x09,0x09,0x09,0x06],
  'Q': [0x3E,0x41,0x51,0x21,0x5E],
  'R': [0x7F,0x09,0x19,0x29,0x46],
  'S': [0x26,0x49,0x49,0x49,0x32],
  'T': [0x03,0x01,0x7F,0x01,0x03],
  'U': [0x3F,0x40,0x40,0x40,0x3F],
  'V': [0x1F,0x20,0x40,0x20,0x1F],
  'W': [0x3F,0x40,0x30,0x40,0x3F],
  'X': [0x63,0x14,0x08,0x14,0x63],
  'Y': [0x07,0x08,0x70,0x08,0x07],
  'Z': [0x61,0x51,0x49,0x45,0x43],
  '[': [0x00,0x7F,0x41,0x41,0x00],
  ']': [0x00,0x41,0x41,0x7F,0x00],
  '_': [0x40,0x40,0x40,0x40,0x40],
  'a': [0x20,0x54,0x54,0x54,0x78],
  'b': [0x7F,0x48,0x44,0x44,0x38],
  'c': [0x38,0x44,0x44,0x44,0x20],
  'd': [0x38,0x44,0x44,0x48,0x7F],
  'e': [0x38,0x54,0x54,0x54,0x18],
  'f': [0x08,0x7E,0x09,0x01,0x02],
  'g': [0x18,0xA4,0xA4,0xA4,0x7C],
  'h': [0x7F,0x08,0x04,0x04,0x78],
  'i': [0x00,0x44,0x7D,0x40,0x00],
  'j': [0x40,0x80,0x84,0x7D,0x00],
  'k': [0x7F,0x10,0x28,0x44,0x00],
  'l': [0x00,0x41,0x7F,0x40,0x00],
  'm': [0x7C,0x04,0x18,0x04,0x78],
  'n': [0x7C,0x08,0x04,0x04,0x78],
  'o': [0x38,0x44,0x44,0x44,0x38],
  'p': [0xFC,0x24,0x24,0x24,0x18],
  'q': [0x18,0x24,0x24,0x28,0xFC],
  'r': [0x7C,0x08,0x04,0x04,0x08],
  's': [0x48,0x54,0x54,0x54,0x20],
  't': [0x04,0x3F,0x44,0x40,0x20],
  'u': [0x3C,0x40,0x40,0x20,0x7C],
  'v': [0x1C,0x20,0x40,0x20,0x1C],
  'w': [0x3C,0x40,0x30,0x40,0x3C],
  'x': [0x44,0x28,0x10,0x28,0x44],
  'y': [0x0C,0x50,0x50,0x50,0x3C],
  'z': [0x44,0x64,0x54,0x4C,0x44],
  // accented — map to base glyph
  '\u00e9': [0x38,0x54,0x54,0x54,0x18], // é
  '\u00e8': [0x38,0x54,0x54,0x54,0x18], // è
  '\u00ea': [0x38,0x54,0x54,0x54,0x18], // ê
  '\u00e0': [0x20,0x54,0x54,0x54,0x78], // à
  '\u00e2': [0x20,0x54,0x54,0x54,0x78], // â
  '\u00fc': [0x3C,0x40,0x40,0x20,0x7C], // ü
  '\u00e7': [0x38,0x44,0x44,0x44,0x20], // ç
  '\u00f4': [0x38,0x44,0x44,0x44,0x38], // ô
  '\u00c9': [0x7F,0x49,0x49,0x49,0x41], // É
};

const CHAR_SPACING = 1; // pixel gap between chars

function hsvToRgb(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r=v; g=t; b=p; break;
    case 1: r=q; g=v; b=p; break;
    case 2: r=p; g=v; b=t; break;
    case 3: r=p; g=q; b=v; break;
    case 4: r=t; g=p; b=v; break;
    case 5: r=v; g=p; b=q; break;
    default: r=0; g=0; b=0;
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

function hexToRgb(hex) {
  if (!hex) return [255, 255, 255];
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
}

function glyph(ch) {
  return GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS[' '];
}

/**
 * Build a scrolling tape for the given text.
 * Returns { tape: Uint8Array(tapeH * tapeW), tapeW, tapeH, scale }
 * tape[row * tapeW + col] = 1 if pixel is on
 */
function buildTape(text, H) {
  const scale  = Math.max(1, Math.floor(H / CHAR_H));
  const charW  = CHAR_W * scale;
  const charH  = CHAR_H * scale;
  const gapW   = CHAR_SPACING * scale;
  const tapeH  = charH;
  const chars  = [...(text || ' ')].map(glyph);
  const tapeW  = chars.length * (charW + gapW);
  const tape   = new Uint8Array(tapeH * tapeW);

  let x = 0;
  for (const cols of chars) {
    for (let cx = 0; cx < CHAR_W; cx++) {
      const col = cols[cx];
      for (let cy = 0; cy < CHAR_H; cy++) {
        if ((col >> cy) & 1) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const tx = x + cx * scale + sx;
              const ty = cy * scale + sy;
              if (tx < tapeW && ty < tapeH) tape[ty * tapeW + tx] = 1;
            }
          }
        }
      }
    }
    x += charW + gapW;
  }
  return { tape, tapeW, tapeH, scale };
}

/**
 * Build a centered static mask for the given text.
 * Returns Uint8Array(H * W) with 1 where text pixel is on.
 */
function buildCenteredMask(text, W, H) {
  const scale  = Math.max(1, Math.floor(H / CHAR_H));
  const charW  = CHAR_W * scale;
  const charH  = CHAR_H * scale;
  const gapW   = CHAR_SPACING * scale;
  const chars  = [...(text || ' ')].map(glyph);
  const textW  = chars.length * charW + (chars.length - 1) * gapW;
  const startX = Math.floor((W - textW) / 2);
  const startY = Math.floor((H - charH) / 2);
  const mask   = new Uint8Array(H * W);

  let x = startX;
  for (const cols of chars) {
    for (let cx = 0; cx < CHAR_W; cx++) {
      const col = cols[cx];
      for (let cy = 0; cy < CHAR_H; cy++) {
        if ((col >> cy) & 1) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = x + cx * scale + sx;
              const py = startY + cy * scale + sy;
              if (px >= 0 && px < W && py >= 0 && py < H) mask[py * W + px] = 1;
            }
          }
        }
      }
    }
    x += charW + gapW;
  }
  return mask;
}

/**
 * Build one or more centered masks without clipping horizontal glyphs.
 * Long text is word-wrapped over two lines and paginated when necessary.
 */
function buildAutoMasks(text, W, H) {
  const normalized = String(text || ' ').replace(/\s+/g, ' ').trim() || ' ';
  const safeWidth = Math.max(1, W - 2); // one clear pixel at both physical edges

  function widthFor(value, scale, spacing) {
    const length = [...value].length;
    return length * CHAR_W * scale + Math.max(0, length - 1) * spacing;
  }

  function renderPage(lines, scale, spacing) {
    const lineHeight = CHAR_H * scale;
    const lineGap = lines.length > 1 ? Math.max(1, H - lineHeight * lines.length) : 0;
    const totalHeight = lineHeight * lines.length + lineGap * Math.max(0, lines.length - 1);
    const startY = Math.floor((H - totalHeight) / 2);
    const mask = new Uint8Array(H * W);

    lines.forEach((line, lineIndex) => {
      const chars = [...(line || ' ')].map(glyph);
      const lineWidth = widthFor(line, scale, spacing);
      let x = Math.floor((W - lineWidth) / 2);
      const y = startY + lineIndex * (lineHeight + lineGap);
      for (const cols of chars) {
        for (let cx = 0; cx < CHAR_W; cx++) {
          const col = cols[cx];
          for (let cy = 0; cy < CHAR_H; cy++) {
            if (!((col >> cy) & 1)) continue;
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px = x + cx * scale + sx;
                const py = y + cy * scale + sy;
                if (px >= 0 && px < W && py >= 0 && py < H) mask[py * W + px] = 1;
              }
            }
          }
        }
        x += CHAR_W * scale + spacing;
      }
    });
    return mask;
  }

  const naturalScale = Math.max(1, Math.floor(H / CHAR_H));
  const naturalSpacing = CHAR_SPACING * naturalScale;
  if (widthFor(normalized, naturalScale, naturalSpacing) <= safeWidth) {
    return [renderPage([normalized], naturalScale, naturalSpacing)];
  }
  if (widthFor(normalized, 1, CHAR_SPACING) <= safeWidth) {
    return [renderPage([normalized], 1, CHAR_SPACING)];
  }
  if (widthFor(normalized, 1, 0) <= safeWidth) {
    return [renderPage([normalized], 1, 0)];
  }

  // Two 7-pixel rows exactly fit the 15-pixel panel. Compact spacing leaves
  // room for eleven characters per line plus a physical edge margin.
  const spacing = 0;
  const maxChars = Math.max(1, Math.floor(safeWidth / CHAR_W));
  const lines = [];
  let current = '';

  for (const wordValue of normalized.split(' ')) {
    const word = [...wordValue];
    while (word.length > maxChars) {
      if (current) { lines.push(current); current = ''; }
      lines.push(word.splice(0, maxChars).join(''));
    }
    const value = word.join('');
    if (!value) continue;
    const candidate = current ? `${current} ${value}` : value;
    if ([...candidate].length <= maxChars) current = candidate;
    else {
      if (current) lines.push(current);
      current = value;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push(' ');

  const pages = [];
  for (let i = 0; i < lines.length; i += 2) {
    pages.push(renderPage(lines.slice(i, i + 2), 1, spacing));
  }
  return pages;
}

function buildAutoMask(text, W, H) {
  return buildAutoMasks(text, W, H)[0];
}

module.exports = { buildTape, buildCenteredMask, buildAutoMask, buildAutoMasks, hsvToRgb, hexToRgb, CHAR_H, CHAR_W, GLYPHS };
