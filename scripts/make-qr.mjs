/* Generates the scannable QR code used in the README. */
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.PAGES_URL || 'https://holynova.github.io/rogue-snake/';
const outDir = path.resolve('media');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'qr.png');

await QRCode.toFile(out, url, {
  errorCorrectionLevel: 'H',
  margin: 2,
  width: 512,
  color: { dark: '#0b1220', light: '#ffffff' },
});

console.log(`QR for ${url} -> ${out}`);
