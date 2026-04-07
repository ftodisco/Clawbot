/**
 * custom-run.js
 * Run the video pipeline with your own script instead of AI-generated content.
 *
 * Usage:
 *   1. Edit custom-script.json with your content
 *   2. Run: npm run custom
 */

import 'dotenv/config';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

import { generateAudio }        from './tts.js';
import { generateThumbnail }    from './thumbnail-generator.js';
import { createVideo, mergeVideoWithAudio } from './video-creator.js';
import { uploadVideo }          from './youtube-uploader.js';
import { generateFalVideo }     from './fal-video-generator.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const execAsync  = promisify(exec);
const TMP_DIR    = join(__dirname, '../tmp');
const OUTPUT_DIR = join(__dirname, '../output');
const niche      = JSON.parse(readFileSync(join(__dirname, '../config/niche.json'), 'utf-8'));
const isDryRun   = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';

// ─── Load custom script ───────────────────────────────────────────────────────

const scriptFile = join(__dirname, '../custom-script.json');
if (!existsSync(scriptFile)) {
  console.error('❌ custom-script.json not found. Copy custom-script.example.json and edit it.');
  process.exit(1);
}

const content = JSON.parse(readFileSync(scriptFile, 'utf-8'));

// Flatten all text into one string for TTS
content.fullScript = [
  content.script?.hook,
  content.script?.intro,
  ...(content.script?.sections || []).map(s => s.content),
  content.script?.outro,
  content.spoken_text,       // simple flat text support
].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

content.isShort = content.format === 'short';

// ─── Run pipeline ─────────────────────────────────────────────────────────────

const runId  = Date.now().toString();
const runDir = join(TMP_DIR, runId);

console.log('\n' + '═'.repeat(60));
console.log('  🎥  Clawbot — Custom Script Mode');
console.log('═'.repeat(60));
console.log(`  Title  : ${content.title}`);
console.log(`  Format : ${content.isShort ? 'Shorts (9:16)' : 'Regular (16:9)'}`);
console.log(`  Mode   : ${isDryRun ? 'DRY RUN (no upload)' : 'LIVE'}`);
console.log('═'.repeat(60) + '\n');

try {
  mkdirSync(runDir, { recursive: true });

  const audioPath = await generateAudio(content.fullScript, runDir, content.language || 'en');

  // Use fal.ai AI video if key is set, otherwise fall back to static thumbnail
  let videoPath;
  if (process.env.FAL_API_KEY) {
    try {
      const falVideoPath = await generateFalVideo(content, runDir);
      videoPath = await mergeVideoWithAudio(falVideoPath, audioPath, content, runDir);
    } catch (err) {
      console.warn(`⚠️  fal.ai failed (${err.message}) — falling back to thumbnail`);
      const thumbnailPath = await generateThumbnail(content, runDir, niche);
      videoPath = await createVideo(thumbnailPath, audioPath, content, runDir);
    }
  } else {
    const thumbnailPath = await generateThumbnail(content, runDir, niche);
    videoPath = await createVideo(thumbnailPath, audioPath, content, runDir);
  }

  if (isDryRun) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const isWindows = process.platform === 'win32';
    const cp = isWindows ? 'copy' : 'cp';
    const outVideo = join(OUTPUT_DIR, `${runId}_video.mp4`);
    const outThumb = join(OUTPUT_DIR, `${runId}_thumbnail.png`);
    await execAsync(`${cp} "${videoPath}" "${outVideo}"`);
    await execAsync(`${cp} "${thumbnailPath}" "${outThumb}"`);
    console.log('\n🏃 DRY RUN — upload skipped.');
    console.log(`   Video     : ${outVideo}`);
    console.log(`   Thumbnail : ${outThumb}`);
  } else {
    const { url } = await uploadVideo(videoPath, thumbnailPath, content);
    console.log(`\n✅ Live at: ${url}`);
  }

} finally {
  if (existsSync(runDir)) {
    try { rmSync(runDir, { recursive: true, force: true }); } catch {}
  }
}
