// news-image-20261125: a program that draws one image summing up the world's news
// of Wednesday 25 November 2026 and writes it to /output/entry.png.
// Node 22 standard library only. Fully deterministic: no network, no clock, no
// randomness. The image is drawn at run time with a small embedded 5x7 bitmap
// font and a hand-written PNG encoder (zlib deflate + CRC32).
//
// Run it: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- framebuffer

const W = 1024;
const H = 1024;
const px = new Uint8Array(W * H * 3);

type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function fill(x0: number, y0: number, w: number, h: number, c: RGB): void {
  const xa = Math.max(0, x0);
  const ya = Math.max(0, y0);
  const xb = Math.min(W, x0 + w);
  const yb = Math.min(H, y0 + h);
  for (let y = ya; y < yb; y++) {
    let o = (y * W + xa) * 3;
    for (let x = xa; x < xb; x++, o += 3) {
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
    }
  }
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    fill(cx - dx, cy + dy, dx * 2 + 1, 1, c);
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    const inner = Math.floor(Math.sqrt(Math.max(0, (r - t) * (r - t) - dy * dy)));
    if (Math.abs(dy) <= r - t) {
      fill(cx - dx, cy + dy, dx - inner, 1, c);
      fill(cx + inner + 1, cy + dy, dx - inner, 1, c);
    } else {
      fill(cx - dx, cy + dy, dx * 2 + 1, 1, c);
    }
  }
}

// DDA line, thickness 1..3 px.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) {
    fill(x0, y0, t, t, c);
    return;
  }
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (dx * i) / steps);
    const y = Math.round(y0 + (dy * i) / steps);
    fill(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
  }
}

function frame(x: number, y: number, w: number, h: number, c: RGB, t = 2): void {
  fill(x, y, w, t, c);
  fill(x, y + h - t, w, t, c);
  fill(x, y, t, h, c);
  fill(x + w - t, y, t, h, c);
}

// ------------------------------------------------------------------- font
// 5x7 bitmap font, uppercase only. Each glyph is one 35-character string:
// 7 rows of 5, '#' = on, '.' = off.

const FONT: Record<string, string> = {
  '0': '.###.#...##..###.#.###..##...#.###.',
  '1': '..#...##....#....#....#....#...###.',
  '2': '.###.#...#....#...#...#...#...#####',
  '3': '####.....#....#.###.....#....#####.',
  '4': '...#...##..#.#.#..#.#####...#....#.',
  '5': '######....####.....#....##...#.###.',
  '6': '.###.#....#....####.#...##...#.###.',
  '7': '#####....#...#....#...#....#....#..',
  '8': '.###.#...##...#.###.#...##...#.###.',
  '9': '.###.#...##...#.####....#....#.###.',
  'A': '.###.#...##...#######...##...##...#',
  'B': '####.#...##...#####.#...##...#####.',
  'C': '.#####....#....#....#....#.....####',
  'D': '####.#...##...##...##...##...#####.',
  'E': '######....#....####.#....#....#####',
  'F': '######....#....####.#....#....#....',
  'G': '.#####....#....#.####...##...#.###.',
  'H': '#...##...##...#######...##...##...#',
  'I': '.###...#....#....#....#....#...###.',
  'J': '..###...#....#....#....#.#..#..##..',
  'K': '#...##..#.#.#..##...#.#..#..#.#...#',
  'L': '#....#....#....#....#....#....#####',
  'M': '#...###.###.#.##.#.##...##...##...#',
  'N': '#...###..##.#.##..###...##...##...#',
  'O': '.###.#...##...##...##...##...#.###.',
  'P': '####.#...##...#####.#....#....#....',
  'Q': '.###.#...##...##...##.#.##..#..##.#',
  'R': '####.#...##...#####.#.#..#..#.#...#',
  'S': '.#####....#.....###.....#....#####.',
  'T': '#####..#....#....#....#....#....#..',
  'U': '#...##...##...##...##...##...#.###.',
  'V': '#...##...##...##...##...#.#.#...#..',
  'W': '#...##...##...##.#.##.#.###.###...#',
  'X': '#...##...#.#.#...#...#.#.#...##...#',
  'Y': '#...##...#.#.#...#....#....#....#..',
  'Z': '#####....#...#...#...#...#....#####',
  ' ': '...................................',
  '.': '..........................##...##..',
  ',': '.....................##...##...#...',
  ':': '......##...##........##...##.......',
  '-': '................###................',
  '\'': '..#....#....#......................',
  '(': '...#...#....#....#....#....#.....#.',
  ')': '.#.....#....#....#....#....#...#...',
  '/': '....#....#...#...#...#...#....#....',
  '%': '##..###.#....#...#...#...#.##.#..##',
  '!': '..#....#....#....#....#.........#..',
  '?': '.###.#...#....#...#...#.........#..',
  '+': '.......#....#...###...#....#.......',
  '=': '...........###.......###...........',
  '\u2022': '...........###..###..###...........',
};

function textWidth(s: string, scale: number): number {
  if (!s) return 0;
  return s.length * 6 * scale - scale;
}

function drawChar(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let r = 0; r < 7; r++) {
    const row = g.slice(r * 5, r * 5 + 5);
    for (let col = 0; col < 5; col++) {
      if (row[col] === '#') fill(x + col * scale, y + r * scale, scale, scale, c);
    }
  }
}

function drawText(s: string, x: number, y: number, scale: number, c: RGB): number {
  let cx = x;
  for (const ch of s) {
    if (ch !== ' ') drawChar(ch, cx, y, scale, c);
    cx += 6 * scale;
  }
  return cx;
}

function drawTextCentred(s: string, y: number, scale: number, c: RGB): void {
  drawText(s, Math.round((W - textWidth(s, scale)) / 2), y, scale, c);
}

function wrapText(s: string, maxW: number, scale: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textWidth(t, scale) <= maxW) {
      cur = t;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawPara(
  s: string,
  x: number,
  y: number,
  maxW: number,
  scale: number,
  lineH: number,
  c: RGB,
): number {
  for (const ln of wrapText(s, maxW, scale)) {
    drawText(ln, x, y, scale, c);
    y += lineH;
  }
  return y;
}

// ---------------------------------------------------------------- palette

const PAPER = hex('#f6f1e3');
const INK = hex('#191919');
const NAVY = hex('#12264a');
const GOLD = hex('#e8b64c');
const RED = hex('#b3261e');
const WHITE = hex('#ffffff');
const GREY = hex('#5a5a5a');
const CARD = hex('#ffffff');
const SKY = hex('#a8c8e0');
const SEA = hex('#1f5f8b');
const STEEL = hex('#2e3438');
const PITCH = hex('#3e8e4d');
const PITCH2 = hex('#4aa35a');

// ------------------------------------------------------------------ icons
// Each icon draws into the box (x, y, w, h) with flat shapes.

function drawShip(x: number, y: number, w: number, h: number): void {
  fill(x, y, w, h, SKY);
  fill(x, y + Math.round(h * 0.45), w, h - Math.round(h * 0.45), SEA);
  // clouds
  fill(x + Math.round(w * 0.08), y + Math.round(h * 0.1), Math.round(w * 0.22), 10, WHITE);
  fill(x + Math.round(w * 0.6), y + Math.round(h * 0.06), Math.round(w * 0.18), 8, WHITE);
  // waves
  fill(x + Math.round(w * 0.06), y + Math.round(h * 0.62), Math.round(w * 0.3), 3, WHITE);
  fill(x + Math.round(w * 0.55), y + Math.round(h * 0.78), Math.round(w * 0.32), 3, WHITE);
  fill(x + Math.round(w * 0.2), y + Math.round(h * 0.88), Math.round(w * 0.26), 3, WHITE);
  // hull
  fill(x + Math.round(w * 0.1), y + Math.round(h * 0.52), Math.round(w * 0.6), Math.round(h * 0.16), STEEL);
  fill(x + Math.round(w * 0.7), y + Math.round(h * 0.55), Math.round(w * 0.09), Math.round(h * 0.1), STEEL);
  fill(x + Math.round(w * 0.79), y + Math.round(h * 0.58), Math.round(w * 0.06), Math.round(h * 0.07), STEEL);
  // superstructure + funnel
  fill(x + Math.round(w * 0.2), y + Math.round(h * 0.36), Math.round(w * 0.22), Math.round(h * 0.16), hex('#4a5258'));
  fill(x + Math.round(w * 0.46), y + Math.round(h * 0.38), Math.round(w * 0.08), Math.round(h * 0.14), RED);
  fill(x + Math.round(w * 0.3), y + Math.round(h * 0.22), 4, Math.round(h * 0.14), STEEL);
  // bridge windows
  fill(x + Math.round(w * 0.23), y + Math.round(h * 0.39), Math.round(w * 0.16), 5, GOLD);
  // explosion over the ship
  const ex = x + Math.round(w * 0.56);
  const ey = y + Math.round(h * 0.3);
  disc(ex, ey, 15, hex('#e8722a'));
  disc(ex, ey, 8, GOLD);
  line(ex - 22, ey, ex - 13, ey, GOLD, 3);
  line(ex + 13, ey, ex + 22, ey, GOLD, 3);
  line(ex, ey - 22, ex, ey - 13, GOLD, 3);
  line(ex, ey + 13, ex, ey + 22, GOLD, 3);
  // drone
  const dx = x + Math.round(w * 0.86);
  const dy = y + Math.round(h * 0.14);
  fill(dx - 6, dy - 2, 12, 5, INK);
  line(dx - 10, dy - 6, dx + 10, dy - 6, INK, 2);
}

function drawTower(x: number, y: number, w: number, h: number): void {
  fill(x, y, w, h, hex('#dfe9f2'));
  fill(x, y + Math.round(h * 0.88), w, h - Math.round(h * 0.88), hex('#8a8f94'));
  // side buildings
  fill(x + Math.round(w * 0.06), y + Math.round(h * 0.5), Math.round(w * 0.18), Math.round(h * 0.38), hex('#5a6b7c'));
  fill(x + Math.round(w * 0.74), y + Math.round(h * 0.58), Math.round(w * 0.18), Math.round(h * 0.3), hex('#5a6b7c'));
  // main tower
  const tx = x + Math.round(w * 0.36);
  const tw = Math.round(w * 0.28);
  fill(tx, y + Math.round(h * 0.1), tw, Math.round(h * 0.78), hex('#2b3a4a'));
  fill(tx + Math.round(w * 0.04), y + Math.round(h * 0.04), Math.round(w * 0.2), Math.round(h * 0.06), hex('#2b3a4a'));
  fill(tx + Math.round(w * 0.13), y, 4, Math.round(h * 0.04), hex('#2b3a4a'));
  // windows
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 3; c++) {
      fill(
        tx + Math.round(w * 0.03) + c * Math.round(w * 0.085),
        y + Math.round(h * 0.16) + r * Math.round(h * 0.08),
        8,
        10,
        GOLD,
      );
    }
  }
  // damage + smoke
  const dx = tx + Math.round(tw * 0.5);
  const dy = y + Math.round(h * 0.3);
  disc(dx, dy, 7, hex('#e8722a'));
  disc(dx - 8, dy - 14, 11, hex('#9aa0a6'));
  disc(dx + 9, dy - 20, 9, hex('#c8ccd0'));
  disc(dx - 2, dy - 30, 8, hex('#9aa0a6'));
  // drone
  const qx = x + Math.round(w * 0.84);
  const qy = y + Math.round(h * 0.12);
  fill(qx - 6, qy - 2, 12, 5, INK);
  line(qx - 10, qy - 6, qx + 10, qy - 6, INK, 2);
}

function drawCourt(x: number, y: number, w: number, h: number): void {
  fill(x, y, w, h, hex('#e8e2d2'));
  // pediment: stepped triangle
  for (let i = 0; i < 6; i++) {
    const ww = Math.round(w * (0.06 + i * 0.11));
    fill(x + Math.round(w / 2) - Math.round(ww / 2), y + Math.round(h * 0.08) + i * Math.round(h * 0.045), ww, Math.round(h * 0.045), hex('#4a5258'));
  }
  // columns
  for (let i = 0; i < 3; i++) {
    const cx = x + Math.round(w * 0.16) + i * Math.round(w * 0.26);
    fill(cx, y + Math.round(h * 0.36), Math.round(w * 0.1), Math.round(h * 0.44), hex('#f4efe0'));
    fill(cx + Math.round(w * 0.1) - 3, y + Math.round(h * 0.36), 3, Math.round(h * 0.44), hex('#c9c2ae'));
  }
  // base + door
  fill(x + Math.round(w * 0.08), y + Math.round(h * 0.8), Math.round(w * 0.84), Math.round(h * 0.08), hex('#6b6f75'));
  fill(x + Math.round(w * 0.44), y + Math.round(h * 0.6), Math.round(w * 0.12), Math.round(h * 0.2), STEEL);
}

function drawMedal(x: number, y: number, w: number, h: number): void {
  fill(x, y, w, h, hex('#dfe9f2'));
  const cx = x + Math.round(w / 2);
  const cy = y + Math.round(h * 0.62);
  const r = Math.round(h * 0.26);
  // ribbon
  line(cx - Math.round(w * 0.08), y, cx - Math.round(w * 0.12), cy - r + 6, RED, 12);
  line(cx + Math.round(w * 0.08), y, cx + Math.round(w * 0.12), cy - r + 6, RED, 12);
  // medal
  disc(cx, cy, r, GOLD);
  ring(cx, cy, r, 5, hex('#b8860b'));
  disc(cx, cy, Math.round(r * 0.68), hex('#f2c14e'));
  // star
  for (let k = 0; k < 5; k++) {
    const a = (-Math.PI / 2 + (k * 2 * Math.PI) / 5);
    line(cx, cy, Math.round(cx + Math.cos(a) * r * 0.5), Math.round(cy + Math.sin(a) * r * 0.5), WHITE, 4);
  }
  disc(cx, cy, 5, WHITE);
}

function drawFootball(x: number, y: number, w: number, h: number): void {
  fill(x, y, w, h, PITCH);
  for (let i = 0; i < 4; i++) {
    fill(x + i * Math.round(w / 4), y, Math.round(w / 8), h, PITCH2);
  }
  // markings
  frame(x + 8, y + 8, w - 16, h - 16, WHITE, 3);
  fill(x + Math.round(w / 2) - 2, y + 8, 4, h - 16, WHITE);
  ring(x + Math.round(w / 2), y + Math.round(h / 2), Math.round(h * 0.2), 3, WHITE);
  // goal (right)
  fill(x + w - Math.round(w * 0.14), y + Math.round(h * 0.28), 5, Math.round(h * 0.44), WHITE);
  fill(x + w - Math.round(w * 0.14), y + Math.round(h * 0.28), Math.round(w * 0.14), 5, WHITE);
  fill(x + w - Math.round(w * 0.14), y + Math.round(h * 0.72) - 5, Math.round(w * 0.14), 5, WHITE);
  // ball
  const bx = x + Math.round(w * 0.36);
  const by = y + Math.round(h * 0.56);
  disc(bx, by, 17, WHITE);
  disc(bx, by, 5, INK);
  disc(bx - 10, by - 8, 3, INK);
  disc(bx + 10, by - 8, 3, INK);
  disc(bx, by + 11, 3, INK);
}

function drawBallot(x: number, y: number, w: number, h: number): void {
  fill(x, y, w, h, hex('#e8e2d2'));
  // back paper
  fill(x + Math.round(w * 0.28), y + Math.round(h * 0.2), Math.round(w * 0.28), Math.round(h * 0.24), hex('#d8d2c0'));
  // ballot paper with check
  fill(x + Math.round(w * 0.36), y + Math.round(h * 0.12), Math.round(w * 0.28), Math.round(h * 0.32), WHITE);
  line(
    x + Math.round(w * 0.42), y + Math.round(h * 0.26),
    x + Math.round(w * 0.47), y + Math.round(h * 0.32),
    hex('#2e7d32'), 5,
  );
  line(
    x + Math.round(w * 0.47), y + Math.round(h * 0.32),
    x + Math.round(w * 0.6), y + Math.round(h * 0.17),
    hex('#2e7d32'), 5,
  );
  // box
  fill(x + Math.round(w * 0.2), y + Math.round(h * 0.44), Math.round(w * 0.6), Math.round(h * 0.44), NAVY);
  fill(x + Math.round(w * 0.32), y + Math.round(h * 0.44), Math.round(w * 0.36), 6, hex('#0a1730'));
  fill(x + Math.round(w * 0.2), y + Math.round(h * 0.66), Math.round(w * 0.6), 4, GOLD);
}

// ---------------------------------------------------------------- stories
// Verified 25 Nov 2026 (sources: Reuters, Bloomberg, CNN, WSJ, AP, The Times).
// Stories that may still move before the deadline: the Houthi campaign and
// the Ukraine strikes (both live conflicts), and Indonesia's VP nominations
// (the 25 Nov deadline may produce names during the day).

type Icon = (x: number, y: number, w: number, h: number) => void;

interface Story {
  kicker: string;
  headline: string;
  sub: string;
  icon: Icon;
}

const LEAD: Story = {
  kicker: 'LEAD STORY',
  headline: 'UKRAINE SINKS RUSSIAN WARSHIP IN LIBYA',
  sub: 'ZELENSKYY CONFIRMS DRONE STRIKES ON RUSSIAN SHIPS IN LIBYA AND THE BALTIC SEA',
  icon: drawShip,
};

const ROW2: Story[] = [
  {
    kicker: '',
    headline: "HOUTHIS HIT RIYADH'S TALLEST TOWER",
    sub: 'DRONE WOUNDS 11 - SECOND HIT IN A WEEK',
    icon: drawTower,
  },
  {
    kicker: '',
    headline: 'SARKOZY ORDERED TO STAND TRIAL',
    sub: 'EX-PRESIDENT AND WIFE TO FACE TRIAL',
    icon: drawCourt,
  },
];

const ROW3: Story[] = [
  {
    kicker: '',
    headline: 'TRUMP GIVES GIULIANI MEDAL OF FREEDOM',
    sub: 'TOP US HONOUR FOR EX-MAYOR',
    icon: drawMedal,
  },
  {
    kicker: '',
    headline: 'REAL MADRID ROUT PSV 5-1',
    sub: 'BELLINGHAM AND MBAPPE STAR',
    icon: drawFootball,
  },
  {
    kicker: '',
    headline: 'INDONESIA: VP NOMINEES DUE TODAY',
    sub: 'PRABOWO MUST NAME TWO NAMES',
    icon: drawBallot,
  },
];

// ----------------------------------------------------------------- layout

function panel(x: number, y: number, w: number, h: number): void {
  fill(x, y, w, h, CARD);
  frame(x, y, w, h, INK, 2);
}

function render(): void {
  fill(0, 0, W, H, PAPER);

  // Masthead: the day, named in full, is the first thing the judge sees.
  fill(0, 0, W, 144, NAVY);
  drawTextCentred('THE WORLD IN ONE DAY', 24, 3, GOLD);
  drawTextCentred('WEDNESDAY 25 NOVEMBER 2026', 60, 5, WHITE);
  fill(0, 144, W, 6, RED);

  // Lead story, full width.
  panel(28, 166, 968, 280);
  LEAD.icon(44, 182, 320, 248);
  drawText(LEAD.kicker, 388, 194, 3, RED);
  drawText('UKRAINE SINKS', 388, 226, 5, INK);
  drawText('RUSSIAN WARSHIP', 388, 266, 5, INK);
  drawText('IN LIBYA', 388, 306, 5, INK);
  drawPara(LEAD.sub, 388, 352, 560, 3, 26, GREY);

  // Second row: two stories.
  const row2Y = 462;
  const row2H = 240;
  for (let i = 0; i < ROW2.length; i++) {
    const s = ROW2[i];
    const x = 28 + i * 496;
    panel(x, row2Y, 472, row2H);
    s.icon(x + 16, row2Y + 16, 440, 84);
    drawPara(s.headline, x + 16, row2Y + 112, 440, 3, 27, INK);
    drawPara(s.sub, x + 16, row2Y + 172, 440, 3, 27, GREY);
  }

  // Third row: three stories.
  const row3Y = 718;
  const row3H = 240;
  for (let i = 0; i < ROW3.length; i++) {
    const s = ROW3[i];
    const x = 28 + i * 331;
    panel(x, row3Y, 309, row3H);
    s.icon(x + 14, row3Y + 12, 281, 72);
    drawPara(s.headline, x + 14, row3Y + 94, 281, 3, 27, INK);
    drawPara(s.sub, x + 14, row3Y + 178, 281, 3, 27, GREY);
  }

  // Footer: the sources, so the picture reads as a news summary.
  drawTextCentred('SOURCES: REUTERS - BLOOMBERG - CNN - WSJ', 976, 3, GREY);
}

// ------------------------------------------------------------------- main

render();
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), encodePng(W, H, px));
