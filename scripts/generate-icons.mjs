import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const mediaDir = path.join(root, 'media');

mkdirSync(mediaDir, { recursive: true });

const lightSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none">
  <defs>
    <linearGradient id="flameOuter" x1="64" y1="12" x2="64" y2="116" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFE35E"/>
      <stop offset="0.42" stop-color="#FF9923"/>
      <stop offset="0.78" stop-color="#DE4313"/>
      <stop offset="1" stop-color="#8F141A"/>
    </linearGradient>
    <linearGradient id="flameInner" x1="64" y1="28" x2="64" y2="112" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFF6CC"/>
      <stop offset="0.55" stop-color="#FFD25B"/>
      <stop offset="1" stop-color="#FF7A1A"/>
    </linearGradient>
    <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.2" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.32 0" result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g filter="url(#softGlow)">
    <path d="M63.9 10.8c-8.8 13.3-15.7 23.6-15.7 35.3 0 6.3 2.1 11.3 5.2 15.6-12.2 5.6-21 17.7-21 31.8 0 20.7 14.9 34.7 31.5 34.7 17 0 31.6-13.6 31.6-33.8 0-12.8-6-22.2-13.8-30.1-5.6-5.7-10.3-11.7-10.3-20.2 0-4.6 1.3-9.6 4.1-15.3-6.7 3.4-10.4 8.2-12.7 13.3-1.9-7.7 0.1-16 1.1-31.3z"
          fill="url(#flameOuter)"/>
    <path d="M68.7 41.2c-5.1 6.6-8.2 12.8-8.2 19.4 0 4.1 1.2 7.6 3.1 10.5-7.5 3.3-12.9 10.8-12.9 19.8 0 12.6 9 21.3 19.2 21.3 10.6 0 19.2-8.6 19.2-20.9 0-7.7-3.6-13.4-8.2-18.3-3.3-3.6-6.2-7.1-6.2-12.2 0-2.7 0.7-5.7 2.2-9.1-3.9 2.1-6.2 4.9-7.6 8.1-0.9-4.1-0.3-8 1.4-18.6z"
          fill="url(#flameInner)" opacity="0.96"/>
    <path d="M63.9 10.8c-8.8 13.3-15.7 23.6-15.7 35.3 0 6.3 2.1 11.3 5.2 15.6-12.2 5.6-21 17.7-21 31.8 0 20.7 14.9 34.7 31.5 34.7 17 0 31.6-13.6 31.6-33.8 0-12.8-6-22.2-13.8-30.1-5.6-5.7-10.3-11.7-10.3-20.2 0-4.6 1.3-9.6 4.1-15.3-6.7 3.4-10.4 8.2-12.7 13.3-1.9-7.7 0.1-16 1.1-31.3z"
          stroke="rgba(32,10,10,0.55)" stroke-width="3" stroke-linejoin="round"/>
  </g>
</svg>
`;

const darkSvg = lightSvg
  .replaceAll('rgba(32,10,10,0.55)', 'rgba(255,255,255,0.30)')
  .replaceAll('stdDeviation="2.2"', 'stdDeviation="2.6"');

writeFileSync(path.join(mediaDir, 'flame-light.svg'), lightSvg, 'utf8');
writeFileSync(path.join(mediaDir, 'flame-dark.svg'), darkSvg, 'utf8');

writeFileSync(path.join(mediaDir, 'icon.png'), renderFlamePng(128), 'binary');

function renderFlamePng(size) {
  const width = size;
  const height = size;
  const samples = 4;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let inside = 0;
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const u = (x + (sx + 0.5) / samples) / width;
          const v = (y + (sy + 0.5) / samples) / height;
          const nx = (u - 0.5) * 2;
          const ny = (v - 0.5) * 2;

          const outer = inOuterFlame(nx, ny);
          if (!outer) {
            continue;
          }

          inside += 1;

          const t = clamp01((ny + 0.95) / 1.9);
          const base = mixColor([143, 20, 26], [255, 227, 94], Math.pow(t, 0.9));
          const hot = mixColor([222, 67, 19], [255, 153, 35], Math.pow(t, 0.65));
          const color = mixColor(hot, base, 0.55);

          const inner = inInnerFlame(nx, ny);
          if (inner) {
            const glow = mixColor([255, 122, 26], [255, 246, 204], Math.pow(t, 1.1));
            color[0] = Math.round(mix(color[0], glow[0], 0.78));
            color[1] = Math.round(mix(color[1], glow[1], 0.78));
            color[2] = Math.round(mix(color[2], glow[2], 0.78));
          }

          const vignette = 1 - 0.18 * Math.min(1, Math.sqrt(nx * nx + ny * ny));
          rAcc += color[0] * vignette;
          gAcc += color[1] * vignette;
          bAcc += color[2] * vignette;
        }
      }

      const a = inside / (samples * samples);
      const idx = (y * width + x) * 4;
      if (a <= 0) {
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
        continue;
      }
      const scale = 1 / inside;
      pixels[idx] = clampByte(rAcc * scale);
      pixels[idx + 1] = clampByte(gAcc * scale);
      pixels[idx + 2] = clampByte(bAcc * scale);
      pixels[idx + 3] = clampByte(255 * a);
    }
  }

  return encodePngRgba(width, height, pixels);
}

function inOuterFlame(x, y) {
  const body = inTeardrop(x, y, 0, 0.05, 0.78, 1.05);
  const wobble = 0.06 * Math.sin(4.2 * x + 2.4 * y) + 0.04 * Math.sin(6.2 * y);
  const distorted = inTeardrop(x, y + wobble, 0, 0.03, 0.76, 1.04);
  return body || distorted;
}

function inInnerFlame(x, y) {
  const shiftX = x - 0.08;
  const shiftY = y + 0.1;
  return inTeardrop(shiftX, shiftY, 0, 0.12, 0.46, 0.72);
}

function inTeardrop(x, y, cx, cy, radius, height) {
  const dx = x - cx;
  const dy = y - cy;
  const circle = dx * dx + (dy + 0.35) * (dy + 0.35) <= radius * radius;
  if (circle && y < 0.55) {
    return true;
  }
  if (y < -0.15 || y > 1.05) {
    return false;
  }
  const t = clamp01((y + 0.15) / (height + 0.15));
  const w = radius * (1 - Math.pow(t, 1.35)) + 0.05;
  const cap = (dx * dx) / (w * w) + Math.pow((dy - 0.25) / height, 2) <= 1;
  return cap;
}

function encodePngRgba(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }

  const idatData = deflateSync(raw, { level: 9 });
  const chunks = [
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0)),
  ];

  return Buffer.concat([signature, ...chunks]);
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let k = 0; k < 8; k += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function clampByte(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

function mixColor(left, right, t) {
  t = clamp01(t);
  return [
    Math.round(mix(left[0], right[0], t)),
    Math.round(mix(left[1], right[1], t)),
    Math.round(mix(left[2], right[2], t)),
  ];
}
