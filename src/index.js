/**
 * index.js
 * Main pipeline orchestrator.
 *
 * Usage:
 *   npm start           — run the full pipeline (generate + upload)
 *   npm run dry-run     — run pipeline but skip YouTube upload
 *   node src/index.js   — same as npm start
 */

import 'dotenv/config';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';

import { generateContent }    from './content-generator.js';
import { generateAudio }      from './tts.js';
import { generateThumbnail }  from './thumbnail-generator.js';
import { createVideo }        from './video-creator.js';
import { uploadVideo, getRecentTitles } from './youtube-uploader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

const TMP_DIR    = join(__dirname, '../tmp');
const OUTPUT_DIR = join(__dirname, '../output');
const niche      = JSON.parse(readFileSync(join(__dirname, '../config/niche.json'), 'utf-8'));

const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';

/**
 * Run the full content generation and upload pipeline.
 * @returns {Promise<object>} Summary of the run
 */
export async function runPipeline() {
  const runId  = Date.now().toString();
  const runDir = join(TMP_DIR, runId);

  printBanner(runId);

  // Validate environment
  await checkDependencies();

  try {
    mkdirSync(runDir, { recursive: true });

    // ── Step 1: Generate content with Claude ───────────────────────────────
    const recentTitles = getRecentTitles(15);
    const content = await generateContent(recentTitles);

    // ── Step 2: Text-to-speech audio ───────────────────────────────────────
    const audioPath = await generateAudio(
      content.fullScript,
      runDir,
      niche.channel.language || 'en'
    );

    // ── Step 3: Thumbnail ──────────────────────────────────────────────────
    const thumbnailPath = await generateThumbnail(content, runDir, niche);

    // ── Step 4: Assemble video ─────────────────────────────────────────────
    const videoPath = await createVideo(thumbnailPath, audioPath, content, runDir);

    // ── Step 5: Upload to YouTube (skip in dry-run mode) ───────────────────
    let result;
    if (isDryRun) {
      // Copy output to persistent output dir for inspection
      if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
      const outVideo     = join(OUTPUT_DIR, `${runId}_video.mp4`);
      const outThumb     = join(OUTPUT_DIR, `${runId}_thumbnail.png`);
      const isWindows = process.platform === 'win32';
      const cpCmd = isWindows ? 'copy' : 'cp';
      await execAsync(`${cpCmd} "${videoPath}" "${outVideo}"`);
      await execAsync(`${cpCmd} "${thumbnailPath}" "${outThumb}"`);

      result = {
        dryRun: true,
        title: content.title,
        topic: content.topic,
        videoFile: outVideo,
        thumbnailFile: outThumb,
      };
      console.log('\n🏃 DRY RUN — YouTube upload skipped.');
      console.log(`   Video saved to:     ${outVideo}`);
      console.log(`   Thumbnail saved to: ${outThumb}`);
    } else {
      const { videoId, url } = await uploadVideo(videoPath, thumbnailPath, content);
      result = { videoId, url, title: content.title, topic: content.topic };
    }

    printSummary(result);
    return result;

  } finally {
    // Always clean up temp files
    if (existsSync(runDir)) {
      try { rmSync(runDir, { recursive: true, force: true }); } catch {}
    }
  }
}

// ─── Dependency check ─────────────────────────────────────────────────────────

async function checkDependencies() {
  if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'No AI API key found. Add one of these to your .env file:\n' +
      '  OPENROUTER_API_KEY=sk-or-...   (recommended)\n' +
      '  ANTHROPIC_API_KEY=sk-ant-...   (direct Anthropic)'
    );
  }

  try {
    await execAsync('ffmpeg -version', { stdio: 'pipe' }).catch(() => { throw new Error('not found'); });
  } catch {
    throw new Error(
      'ffmpeg is required but not found.\n' +
      'Install it with:\n' +
      '  Ubuntu/Debian: sudo apt-get install ffmpeg\n' +
      '  Termux:        pkg install ffmpeg\n' +
      '  macOS:         brew install ffmpeg'
    );
  }

  try {
    await execAsync('ffprobe -version', { stdio: 'pipe' }).catch(() => { throw new Error('not found'); });
  } catch {
    throw new Error('ffprobe (part of ffmpeg) is required. Please install ffmpeg.');
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function printBanner(runId) {
  console.log('\n' + '═'.repeat(60));
  console.log('  🎥  Clawbot YouTube Automation');
  console.log('═'.repeat(60));
  console.log(`  Channel : ${niche.channel.name}`);
  console.log(`  Niche   : ${niche.channel.niche}`);
  console.log(`  Mode    : ${isDryRun ? 'DRY RUN (no upload)' : 'LIVE'}`);
  console.log(`  Run ID  : ${runId}`);
  console.log('═'.repeat(60) + '\n');
}

function printSummary(result) {
  console.log('\n' + '═'.repeat(60));
  console.log('  ✅  Pipeline complete!');
  console.log('═'.repeat(60));
  if (result.url)   console.log(`  URL   : ${result.url}`);
  if (result.title) console.log(`  Title : ${result.title}`);
  if (result.topic) console.log(`  Topic : ${result.topic}`);
  console.log('═'.repeat(60) + '\n');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runPipeline().catch(err => {
    console.error('\n❌ Pipeline error:', err.message);
    process.exit(1);
  });
}
