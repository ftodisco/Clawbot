/**
 * thumbnail-generator.js
 * Generates a 1280×720 YouTube thumbnail.
 * Primary: node-canvas (rich graphics, requires native libs)
 * Fallback: ffmpeg drawtext (works everywhere ffmpeg is installed)
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

const W = 1280;
const H = 720;

/**
 * Generate a thumbnail image for the video.
 * @param {object} content - Content object from content-generator
 * @param {string} outputDir - Directory to save the thumbnail
 * @param {object} nicheConfig - Full niche.json config
 * @returns {Promise<string>} Path to the generated thumbnail.png
 */
export async function generateThumbnail(content, outputDir, nicheConfig) {
  console.log('🎨 Generating thumbnail...');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  try {
    return await canvasThumbnail(content, outputDir, nicheConfig);
  } catch {
    console.log('   canvas unavailable, using ffmpeg fallback...');
    return await ffmpegThumbnail(content, outputDir, nicheConfig);
  }
}

// ─── Canvas implementation ────────────────────────────────────────────────────

async function canvasThumbnail(content, outputDir, config) {
  // Dynamic import so the module load failure is caught above
  const { createCanvas } = await import('canvas');

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const primary = hexToRgb(config.channel.primaryColor || '#0d1117');
  const accent = hexToRgb(config.channel.accentColor || '#58a6ff');

  // Dark gradient background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, `rgb(${primary.r},${primary.g},${primary.b})`);
  bg.addColorStop(1, `rgb(${clamp(primary.r + 20)},${clamp(primary.g + 20)},${clamp(primary.b + 30)})`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Radial glow top-right
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.15, 0, W * 0.85, H * 0.15, 300);
  glow.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},0.25)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Bottom accent bar
  ctx.fillStyle = `rgb(${accent.r},${accent.g},${accent.b})`;
  ctx.fillRect(0, H - 6, W, 6);

  // Channel name
  ctx.font = 'bold 30px sans-serif';
  ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},0.9)`;
  ctx.fillText(config.channel.name.toUpperCase(), 50, 58);

  // Thumbnail headline
  const headline = (content.thumbnail_text || content.title || '').toUpperCase();
  ctx.shadowColor = `rgba(${accent.r},${accent.g},${accent.b},0.6)`;
  ctx.shadowBlur = 18;

  const lines = wrapText(ctx, headline, 50, 140, W - 80, 'bold 86px sans-serif', 100);
  lines.forEach(({ text, y }) => {
    ctx.font = 'bold 86px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 50, y);
  });

  // Topic pill
  ctx.shadowBlur = 0;
  const pill = truncate(content.topic || 'AI Automation', 44);
  ctx.font = '26px sans-serif';
  const pillW = ctx.measureText(pill).width + 36;
  ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},0.8)`;
  roundedRect(ctx, 50, H - 82, pillW, 44, 22);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(pill, 68, H - 50);

  const outputPath = join(outputDir, 'thumbnail.png');
  writeFileSync(outputPath, canvas.toBuffer('image/png'));
  console.log(`✅ Thumbnail (canvas): ${outputPath}`);
  return outputPath;
}

// ─── ffmpeg fallback ──────────────────────────────────────────────────────────

async function ffmpegThumbnail(content, outputDir, config) {
  const outputPath = join(outputDir, 'thumbnail.png');
  const primary = config.channel.primaryColor || '0d1117';
  const accent = config.channel.accentColor || '58a6ff';
  const pHex = primary.replace('#', '');
  const aHex = accent.replace('#', '');

  // Build headline text (safe for ffmpeg drawtext)
  const headline = escapeDrawtext(
    (content.thumbnail_text || content.title || 'AI AUTOMATION').toUpperCase().slice(0, 50)
  );
  const channelName = escapeDrawtext(config.channel.name.toUpperCase());
  const topic = escapeDrawtext(truncate(content.topic || 'AI Automation', 40));

  // Find a usable font
  const font = await detectFont();
  const fontArg = font ? `:fontfile='${font}'` : '';

  const vf = [
    // Background gradient (dark)
    `color=c=0x${pHex}:s=${W}x${H}:r=1`,
  ].join(',');

  // We pipe a lavfi color source through drawtext filters
  const drawFilters = [
    `drawbox=x=0:y=${H - 6}:w=${W}:h=6:c=0x${aHex}:t=fill`,
    `drawtext=text='${channelName}'${fontArg}:fontcolor=0x${aHex}:fontsize=30:x=50:y=44`,
    `drawtext=text='${headline}'${fontArg}:fontcolor=white:fontsize=72:x=50:y=140:box=1:boxcolor=black@0.0:shadowx=3:shadowy=3:shadowcolor=0x${aHex}`,
    `drawtext=text='${topic}'${fontArg}:fontcolor=white:fontsize=26:x=50:y=${H - 70}:box=1:boxcolor=0x${aHex}@0.8:boxborderw=12`,
  ].join(',');

  await execAsync(
    `ffmpeg -f lavfi -i "${vf}" -vf "${drawFilters}" -frames:v 1 -update 1 "${outputPath}" -y `
  );
  console.log(`✅ Thumbnail (ffmpeg): ${outputPath}`);
  return outputPath;
}

async function detectFont() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/system/fonts/Roboto-Bold.ttf',
    '/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  ];
  for (const f of candidates) {
    if (existsSync(f)) return f;
  }
  return null; // ffmpeg will use its built-in font
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapText(ctx, text, x, startY, maxW, font, lineH) {
  ctx.font = font;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  let y = startY;

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push({ text: line, y });
      line = word;
      y += lineH;
    } else {
      line = test;
    }
  }
  if (line) lines.push({ text: line, y });
  return lines;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
}

function clamp(v, min = 0, max = 255) { return Math.min(max, Math.max(min, v)); }

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\n/g, ' ')
    .replace(/[<>]/g, '');
}
