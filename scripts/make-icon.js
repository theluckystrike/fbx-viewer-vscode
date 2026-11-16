'use strict';
// Draws icon.png (128 x 128): a shaded box with an orange bone chain on a dark slate tile. Our own design.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const W = 128, H = 128;
const px = Buffer.alloc(W * H * 4);
const set = (x, y, [r, g, b], a = 255) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; const k = a / 255; px[i] = Math.round(px[i] * (1 - k) + r * k); px[i + 1] = Math.round(px[i + 1] * (1 - k) + g * k); px[i + 2] = Math.round(px[i + 2] * (1 - k) + b * k); px[i + 3] = Math.max(px[i + 3], a); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const R = 22;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = Math.max(R - x, 0, x - (W - 1 - R)), dy = Math.max(R - y, 0, y - (H - 1 - R));
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= R) set(x, y, mix(hex('#2A3346'), hex('#141925'), y / H), d > R - 1 ? Math.round(255 * (R - d)) : 255);
}
// isometric box: three faces filled by point-in-polygon tests
const C = [62, 66], S = 34;
const top = [[C[0], C[1] - S], [C[0] + S * 0.87, C[1] - S / 2], [C[0], C[1]], [C[0] - S * 0.87, C[1] - S / 2]];
const left = [[C[0] - S * 0.87, C[1] - S / 2], [C[0], C[1]], [C[0], C[1] + S], [C[0] - S * 0.87, C[1] + S / 2]];
const right = [[C[0], C[1]], [C[0] + S * 0.87, C[1] - S / 2], [C[0] + S * 0.87, C[1] + S / 2], [C[0], C[1] + S]];
function inside(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; }
function fill(poly, col) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let n = 0; for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if (inside([x + ox, y + oy], poly)) n++; if (n) set(x, y, col, Math.round(255 * n / 4)); } }
fill(top, hex('#9FB4D6')); fill(left, hex('#5D7398')); fill(right, hex('#465A7C'));
function line(a, b, w, col) { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2); for (let i = 0; i <= n; i++) { const t = i / n; disc(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, w, col); } }
function disc(cx, cy, r, col, a = 255) { for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) { const d = Math.hypot(x - cx, y - cy); if (d <= r + 0.5) set(x, y, col, Math.round(a * Math.min(1, r + 0.5 - d))); } }
const edge = hex('#DCE6F5');
for (const poly of [top, left, right]) for (let i = 0; i < poly.length; i++) line(poly[i], poly[(i + 1) % poly.length], 0.7, edge);
// bone chain over the box
const joints = [[34, 108], [56, 86], [84, 74], [104, 46]];
for (let i = 0; i < joints.length - 1; i++) line(joints[i], joints[i + 1], 3.2, hex('#FF8A1F'));
for (const [x, y] of joints) { disc(x, y, 6.5, hex('#FF8A1F')); disc(x, y, 3, hex('#FFE2C2')); }
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(path.join(__dirname, '..', 'icon.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('icon.png written');
