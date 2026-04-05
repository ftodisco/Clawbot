/**
 * youtube-uploader.js
 * Uploads the generated video to YouTube using the Data API v3.
 * Requires OAuth2 credentials from `npm run auth`.
 */

import { google } from 'googleapis';
import { createReadStream, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = join(__dirname, '../.youtube-credentials.json');
const HISTORY_PATH = join(__dirname, '../.upload-history.json');

/**
 * Upload a video and its thumbnail to YouTube.
 * @param {string} videoPath - Path to the MP4 file
 * @param {string} thumbnailPath - Path to the thumbnail PNG
 * @param {object} content - Generated content metadata
 * @returns {Promise<{videoId: string, url: string}>}
 */
export async function uploadVideo(videoPath, thumbnailPath, content) {
  console.log('📤 Uploading to YouTube...');

  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      'YouTube credentials not found.\n' +
      'Run `npm run auth` to authenticate with your Google account first.'
    );
  }

  const auth = buildOAuth2Client();
  const youtube = google.youtube({ version: 'v3', auth });

  // Build title: append #Shorts tag for short-form content
  const title = content.isShort && !content.title.includes('#Shorts')
    ? `${content.title} #Shorts`
    : content.title;

  const description = buildDescription(content);
  const privacy = process.env.UPLOAD_PRIVACY || 'public';

  console.log(`   Title: ${title}`);
  console.log(`   Privacy: ${privacy}`);

  // Upload the video (uses resumable upload internally via googleapis)
  let videoResponse;
  try {
    videoResponse = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags: content.tags || [],
          categoryId: content.category_id || '28',
          defaultLanguage: 'en',
        },
        status: {
          privacyStatus: privacy,
          selfDeclaredMadeForKids: false,
        },
      },
      media: { body: createReadStream(videoPath) },
    });
  } catch (err) {
    if (err.code === 401) {
      throw new Error('YouTube auth expired. Run `npm run auth` to re-authenticate.');
    }
    throw err;
  }

  const videoId = videoResponse.data.id;
  const url = `https://youtu.be/${videoId}`;
  console.log(`   Video uploaded → ${url}`);

  // Set custom thumbnail
  try {
    await youtube.thumbnails.set({
      videoId,
      media: { body: createReadStream(thumbnailPath) },
    });
    console.log('   Thumbnail applied');
  } catch (err) {
    // Thumbnail upload requires a verified account with no community strikes
    console.warn(`   Could not set thumbnail: ${err.message}`);
    console.warn('   (Custom thumbnails require a verified YouTube account)');
  }

  saveToHistory({ videoId, title, url, topic: content.topic });

  return { videoId, url };
}

/**
 * Return the titles of the most recent uploads (to avoid content repetition).
 * @param {number} limit
 * @returns {string[]}
 */
export function getRecentTitles(limit = 15) {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
    return history.slice(0, limit).map(h => h.title);
  } catch {
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildOAuth2Client() {
  const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
  oauth2.setCredentials({ refresh_token: creds.refresh_token });
  return oauth2;
}

function buildDescription(content) {
  const links = [
    '🔗 OpenClaw Framework: https://github.com/openclaw',
    '🤖 Google AI Studio (Gemini): https://aistudio.google.com',
    '📱 Termux for Android: https://termux.dev',
  ].join('\n');

  return (content.description || '')
    .replace('[LINKS]', links)
    .trim();
}

function saveToHistory(entry) {
  let history = [];
  if (existsSync(HISTORY_PATH)) {
    try { history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8')); } catch {}
  }
  history.unshift({ ...entry, uploadedAt: new Date().toISOString() });
  writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(0, 100), null, 2));
}
