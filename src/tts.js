/**
 * tts.js
 * Text-to-speech audio generation.
 * Primary: Google TTS (free, no API key needed)
 * Optional: ElevenLabs (higher quality, requires ELEVENLABS_API_KEY)
 */

import googleTTS from 'google-tts-api';
import axios from 'axios';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const CHUNK_SIZE = 180; // Google TTS max chars per request (safe limit)

/**
 * Generate an MP3 audio file from the given text.
 * @param {string} text - The full script to convert to speech
 * @param {string} outputDir - Directory to write audio files
 * @param {string} lang - Language code (default: 'en')
 * @returns {Promise<string>} Path to the merged audio.mp3
 */
export async function generateAudio(text, outputDir, lang = 'en') {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const provider = process.env.TTS_PROVIDER || 'google';

  if (provider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
    return generateElevenLabsAudio(text, outputDir);
  }
  return generateGoogleAudio(text, outputDir, lang);
}

// ─── Google TTS ───────────────────────────────────────────────────────────────

async function generateGoogleAudio(text, outputDir, lang) {
  console.log('🔊 Generating audio via Google TTS...');

  const chunks = splitIntoChunks(text, CHUNK_SIZE);
  console.log(`   ${chunks.length} chunks to synthesize`);

  const chunkPaths = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = join(outputDir, `chunk_${String(i).padStart(3, '0')}.mp3`);
    await downloadGoogleChunk(chunks[i], lang, chunkPath, i);
    chunkPaths.push(chunkPath);
  }

  const outputPath = join(outputDir, 'audio.mp3');
  await mergeAudioFiles(chunkPaths, outputDir, outputPath);

  console.log(`✅ Audio ready: ${outputPath}`);
  return outputPath;
}

async function downloadGoogleChunk(text, lang, outputPath, index) {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const url = googleTTS.getAudioUrl(text, { lang, slow: false, host: 'https://translate.google.com' });
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      writeFileSync(outputPath, Buffer.from(response.data));

      // Rate-limit courtesy delay
      if (index > 0) await sleep(350);
      return;
    } catch (err) {
      if (attempt === maxRetries - 1) {
        console.warn(`   Chunk ${index} failed after ${maxRetries} tries — inserting silence`);
        await execAsync(`ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 1 -q:a 9 -acodec libmp3lame "${outputPath}" -y `);
      } else {
        await sleep(1000 * (attempt + 1));
      }
    }
  }
}

// ─── ElevenLabs TTS ───────────────────────────────────────────────────────────

async function generateElevenLabsAudio(text, outputDir) {
  console.log('🔊 Generating audio via ElevenLabs...');

  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default: Rachel
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  // ElevenLabs supports longer text but we chunk at 2500 chars to be safe
  const chunks = splitIntoChunks(text, 2500);
  const chunkPaths = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = join(outputDir, `chunk_${String(i).padStart(3, '0')}.mp3`);
    const response = await axios.post(
      url,
      { text: chunks[i], model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.75 } },
      { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, responseType: 'arraybuffer' }
    );
    writeFileSync(chunkPath, Buffer.from(response.data));
    chunkPaths.push(chunkPath);
    if (i < chunks.length - 1) await sleep(500);
  }

  const outputPath = join(outputDir, 'audio.mp3');
  await mergeAudioFiles(chunkPaths, outputDir, outputPath);

  console.log(`✅ Audio ready: ${outputPath}`);
  return outputPath;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split text into sentence-aware chunks of at most maxChars characters.
 */
function splitIntoChunks(text, maxChars) {
  // Split on sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;

    if (current.length + s.length + 1 <= maxChars) {
      current = current ? `${current} ${s}` : s;
    } else {
      if (current) chunks.push(current);
      // If a single sentence exceeds limit, split by words
      if (s.length > maxChars) {
        const words = s.split(' ');
        let wordBuf = '';
        for (const w of words) {
          if (wordBuf.length + w.length + 1 <= maxChars) {
            wordBuf = wordBuf ? `${wordBuf} ${w}` : w;
          } else {
            if (wordBuf) chunks.push(wordBuf);
            wordBuf = w;
          }
        }
        current = wordBuf;
      } else {
        current = s;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Concatenate multiple MP3 files into one using ffmpeg.
 */
async function mergeAudioFiles(chunkPaths, outputDir, outputPath) {
  const listFile = join(outputDir, 'chunks.txt');
  writeFileSync(listFile, chunkPaths.map(f => `file '${f}'`).join('\n'));
  await execAsync(`ffmpeg -f concat -safe 0 -i "${listFile}" -acodec copy "${outputPath}" -y `);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
