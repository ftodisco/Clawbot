/**
 * fal-video-generator.js
 * Generates AI video clips using fal.ai (Kling model).
 * Requires FAL_API_KEY in .env
 *
 * Returns a local path to the downloaded video file,
 * or null if FAL_API_KEY is not set (falls back to thumbnail).
 */

import axios from 'axios';
import { createWriteStream } from 'fs';
import { join } from 'path';

const FAL_BASE = 'https://queue.fal.run';
const MODEL    = 'fal-ai/kling-video/v1.6/standard/text-to-video';
const POLL_MS  = 5000;   // poll every 5 seconds
const MAX_WAIT = 360000; // give up after 6 minutes

export async function generateFalVideo(content, outputDir) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) return null;

  const prompt      = buildVideoPrompt(content);
  const isShort     = content.isShort !== false;
  const aspectRatio = isShort ? '9:16' : '16:9';

  console.log('🎬 Generating AI video with fal.ai (Kling)...');
  console.log(`   Prompt: ${prompt.slice(0, 90)}...`);

  const headers = {
    Authorization: `Key ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // ── Submit job ────────────────────────────────────────────────────────────
  const submitRes = await axios.post(
    `${FAL_BASE}/${MODEL}`,
    {
      prompt,
      duration: '10',
      aspect_ratio: aspectRatio,
      negative_prompt: 'blur, low quality, distorted, ugly, text overlay, watermark, nsfw',
    },
    { headers }
  );

  const requestId = submitRes.data.request_id;
  if (!requestId) throw new Error('fal.ai did not return a request_id');
  console.log(`   Job queued: ${requestId}`);

  // ── Poll for completion ───────────────────────────────────────────────────
  const statusUrl = `${FAL_BASE}/${MODEL}/requests/${requestId}/status`;
  const deadline  = Date.now() + MAX_WAIT;
  let elapsed     = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    elapsed += POLL_MS;

    const { data } = await axios.get(statusUrl, { headers });

    if (data.status === 'COMPLETED') break;
    if (data.status === 'FAILED') {
      throw new Error(`fal.ai generation failed: ${JSON.stringify(data.error || data)}`);
    }

    if (elapsed % 30000 === 0) {
      console.log(`   Still generating... (${Math.round(elapsed / 1000)}s elapsed)`);
    }
  }

  // ── Fetch result ──────────────────────────────────────────────────────────
  const resultRes = await axios.get(
    `${FAL_BASE}/${MODEL}/requests/${requestId}`,
    { headers }
  );

  const videoUrl = resultRes.data.video?.url;
  if (!videoUrl) throw new Error('fal.ai result had no video URL');

  // ── Download video ────────────────────────────────────────────────────────
  const videoPath = join(outputDir, 'fal_video.mp4');
  await downloadFile(videoUrl, videoPath);
  console.log(`✅ AI video downloaded: ${videoPath}`);

  return videoPath;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildVideoPrompt(content) {
  // Allow explicit override in the script JSON
  if (content.video_prompt) return content.video_prompt;

  const topic = (content.topic || content.title || '').toLowerCase();
  const text  = (content.thumbnail_text || '').toLowerCase();

  if (topic.includes('wedding') || text.includes('wedding') || text.includes('bride')) {
    return (
      'Cinematic wedding scene, modern bride and groom stepping out together hand in hand, ' +
      'joyful genuine smiles, guests cheering in background, golden hour sunlight, slow motion, ' +
      'photorealistic, professional cinematography, beautiful soft bokeh, 4K'
    );
  }

  if (topic.includes('ai') || topic.includes('tech') || topic.includes('automat')) {
    return (
      `Cinematic technology scene, ${topic}, sleek futuristic aesthetic, ` +
      'dynamic glowing interfaces, smooth camera movement, photorealistic, professional lighting, 4K'
    );
  }

  // Generic fallback using topic
  return (
    `Cinematic ${topic || 'lifestyle'} scene, ` +
    `${content.thumbnail_text ? content.thumbnail_text + ', ' : ''}` +
    'professional cinematography, beautiful lighting, smooth camera movement, photorealistic, 4K'
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function downloadFile(url, dest) {
  const response = await axios.get(url, { responseType: 'stream' });
  const writer   = createWriteStream(dest);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
