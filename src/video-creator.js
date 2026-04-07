/**
 * video-creator.js
 * Assembles the final MP4 using ffmpeg:
 *   - Thumbnail image looped to audio duration
 *   - Text overlays showing script sections at timed intervals
 *   - H.264 video + AAC audio at YouTube-recommended specs
 *
 * Supports both YouTube Shorts (1080×1920, <60s) and regular (1920×1080).
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Create an MP4 video from a thumbnail image + audio.
 * @param {string} thumbnailPath
 * @param {string} audioPath
 * @param {object} content - Content object with script sections
 * @param {string} outputDir
 * @returns {Promise<string>} Path to the output video.mp4
 */
/**
 * Merge a fal.ai-generated video clip with TTS audio.
 * Loops the clip if it is shorter than the audio.
 */
export async function mergeVideoWithAudio(falVideoPath, audioPath, content, outputDir) {
  console.log('🎞️  Merging AI video with voiceover...');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const outputPath  = join(outputDir, 'video.mp4');
  const duration    = await getAudioDuration(audioPath);
  const videoDur    = content.isShort ? Math.min(duration, 59) : duration;

  console.log(`   Audio: ${duration.toFixed(1)}s | Format: ${content.isShort ? 'Shorts (9:16)' : 'Regular (16:9)'}`);

  const cmd = [
    'ffmpeg',
    `-stream_loop -1 -i "${falVideoPath}"`,
    `-i "${audioPath}"`,
    `-t ${videoDur}`,
    `-map 0:v -map 1:a`,
    `-c:v libx264 -preset fast -crf 23`,
    `-c:a aac -b:a 128k`,
    `-pix_fmt yuv420p`,
    `-movflags +faststart`,
    `"${outputPath}" -y`,
  ].join(' ');

  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
  console.log(`✅ Video created: ${outputPath}`);
  return outputPath;
}

export async function createVideo(thumbnailPath, audioPath, content, outputDir) {
  console.log('🎬 Creating video with ffmpeg...');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const outputPath = join(outputDir, 'video.mp4');
  const isShort = content.isShort === true;

  // Get audio duration
  const duration = await getAudioDuration(audioPath);
  console.log(`   Audio: ${duration.toFixed(1)}s | Format: ${isShort ? 'Shorts (9:16)' : 'Regular (16:9)'}`);

  // For Shorts, cap at 59 seconds
  const videoDuration = isShort ? Math.min(duration, 59) : duration;

  // Target resolution
  const [vw, vh] = isShort ? [1080, 1920] : [1920, 1080];

  // Build scale+pad filter to fit thumbnail into target resolution
  const scalePad = `scale=${vw}:${vh}:force_original_aspect_ratio=decrease,pad=${vw}:${vh}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

  // Build text overlay filters for script sections
  const textFilters = buildTextFilters(content, videoDuration, vw, vh);

  let filterChain;
  if (textFilters.length === 0) {
    filterChain = null; // No overlays needed
  } else {
    // Chain: [0:v] → scalePad → text_0 → text_1 → ... → [vout]
    const steps = [];
    steps.push(`[0:v]${scalePad}[sp]`);
    let prev = '[sp]';
    for (let i = 0; i < textFilters.length; i++) {
      const next = i === textFilters.length - 1 ? '[vout]' : `[t${i}]`;
      steps.push(`${prev}${textFilters[i]}${next}`);
      prev = `[t${i}]`;
    }
    filterChain = steps.join(';');
  }

  const baseArgs = [
    `ffmpeg`,
    `-loop 1 -i "${thumbnailPath}"`,
    `-i "${audioPath}"`,
    `-t ${videoDuration}`,
  ];

  let encodingArgs;
  if (filterChain) {
    encodingArgs = [
      `-filter_complex "${filterChain}"`,
      `-map "[vout]" -map 1:a`,
    ];
  } else {
    encodingArgs = [
      `-vf "${scalePad}"`,
    ];
  }

  encodingArgs.push(
    `-c:v libx264`,
    `-preset fast`,
    `-crf 23`,
    `-c:a aac`,
    `-b:a 128k`,
    `-pix_fmt yuv420p`,
    `-movflags +faststart`,
    `-shortest`,
    `"${outputPath}" -y`,
  );

  const cmd = [...baseArgs, ...encodingArgs].join(' ');
  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

  console.log(`✅ Video created: ${outputPath}`);
  return outputPath;
}

// ─── Text overlay helpers ─────────────────────────────────────────────────────

/**
 * Build an array of ffmpeg drawtext filter strings for section titles.
 * Each section's title fades in for its time window.
 */
function buildTextFilters(content, totalDuration, vw, vh) {
  const { script } = content;
  if (!script || !script.sections) return [];

  const font = ''; // Use built-in ffmpeg font
  const textY = Math.round(vh * 0.88); // Bottom 12% of screen
  const sections = script.sections.slice(0, 4); // Max 4 overlays

  // Distribute section times evenly across the video
  const sectionDuration = totalDuration / (sections.length + 2);
  const filters = [];

  // Hook overlay at the very start
  if (script.hook) {
    const hookText = escapeDrawtext(script.hook.slice(0, 70));
    filters.push(
      `drawtext=text='${hookText}'${font}:fontcolor=white:fontsize=${Math.round(vw * 0.038)}` +
      `:x=(w-text_w)/2:y=${textY}` +
      `:box=1:boxcolor=black@0.65:boxborderw=12` +
      `:enable='between(t,0,${Math.min(sectionDuration, totalDuration - 1).toFixed(1)})'`
    );
  }

  // Section title overlays
  sections.forEach((section, i) => {
    const start = (i + 1) * sectionDuration;
    const end = Math.min((i + 2) * sectionDuration, totalDuration - 1);
    if (start >= totalDuration) return;

    const label = escapeDrawtext((section.title || '').slice(0, 60));
    if (!label) return;

    filters.push(
      `drawtext=text='${label}'${font}:fontcolor=white:fontsize=${Math.round(vw * 0.038)}` +
      `:x=(w-text_w)/2:y=${textY}` +
      `:box=1:boxcolor=black@0.65:boxborderw=12` +
      `:enable='between(t,${start.toFixed(1)},${end.toFixed(1)})'`
    );
  });

  return filters;
}

async function getAudioDuration(audioPath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
  );
  return parseFloat(stdout.trim()) || 30;
}

function escapeDrawtext(text) {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\n/g, ' ')
    .replace(/[<>]/g, '')
    .trim();
}
