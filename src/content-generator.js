/**
 * content-generator.js
 * Uses Claude claude-opus-4-6 with adaptive thinking to generate a complete
 * YouTube video package: title, description, tags, script, and thumbnail text.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const niche = JSON.parse(readFileSync(join(__dirname, '../config/niche.json'), 'utf-8'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate a complete YouTube video content package.
 * @param {string[]} previousTitles - Recently used titles to avoid repetition
 * @returns {Promise<object>} Content object with title, description, tags, script, etc.
 */
export async function generateContent(previousTitles = []) {
  console.log('🤖 Generating content with Claude claude-opus-4-6...');

  const isShort = niche.videoStyle.videoDuration === 'short';
  const topicsList = niche.topics.map(t => `- ${t}`).join('\n');
  const avoidSection = previousTitles.length > 0
    ? `\nRecently used titles to AVOID:\n${previousTitles.map(t => `- ${t}`).join('\n')}`
    : '';

  const formatGuide = isShort
    ? `YouTube Short (vertical, under 60 seconds). Script must be ~100–130 words total. Add "#Shorts" at end of title.`
    : `Regular YouTube video (5–8 minutes). Script must be ~900–1200 words total across all sections.`;

  const prompt = `You are a YouTube content creator for the channel "${niche.channel.name}".

Channel tagline: "${niche.channel.tagline}"
Niche: ${niche.channel.niche}
Target audience: ${niche.videoStyle.targetAudience}
Tone: ${niche.videoStyle.tone}
Format: ${formatGuide}

Topic pool (choose one or combine creatively):
${topicsList}
${avoidSection}

Generate a complete video package. Return ONLY valid JSON matching this structure exactly:

{
  "title": "SEO-optimized YouTube title under 70 characters",
  "description": "Full YouTube description 300–500 words. Include:\\n\\n📌 What you'll learn:\\n- Point 1\\n- Point 2\\n\\n🔗 Resources:\\n[LINKS]\\n\\n${niche.seo.baseHashtags.join(' ')} #YourRelevantTag1 #YourRelevantTag2",
  "tags": ["15", "to", "20", "relevant", "tags", "as", "array"],
  "thumbnail_text": "Bold 3–5 word thumbnail headline in ALL CAPS",
  "topic": "The specific topic you chose",
  "category_id": "28",
  "script": {
    "hook": "Attention-grabbing first sentence or question (spoken text only, ~20 words)",
    "intro": "Brief intro: who this is for and what they'll learn (~30 words)",
    "sections": [
      {
        "title": "Section heading",
        "content": "Spoken script content for this section. Conversational and specific.",
        "duration_seconds": 30
      }
    ],
    "outro": "Call to action: ${niche.videoStyle.callToAction} (~20 words)"
  }
}

Requirements:
- Script must be natural spoken language, not bullet points
- Include specific technical details (commands, API names, file paths where relevant)
- Make the hook immediately valuable — answer a question or solve a problem
- Tags should mix broad (#AndroidAI) and specific (#OpenClawSetup) terms`;

  // Use streaming since script generation can produce long output
  const stream = await client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });

  const response = await stream.finalMessage();

  // Extract text blocks only (skip thinking blocks)
  const textContent = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const jsonMatch = textContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude did not return valid JSON. Raw response:\n' + textContent.slice(0, 500));
  }

  const content = JSON.parse(jsonMatch[0]);

  // Build flat script text for TTS
  content.fullScript = buildFullScript(content.script);
  content.isShort = isShort;

  console.log(`✅ Content generated: "${content.title}"`);
  console.log(`   Topic: ${content.topic}`);
  console.log(`   Script length: ~${content.fullScript.split(' ').length} words`);

  return content;
}

/**
 * Flatten the structured script into a single string for TTS.
 */
function buildFullScript(script) {
  if (!script) return '';
  const parts = [
    script.hook,
    script.intro,
    ...(script.sections || []).map(s => s.content),
    script.outro,
  ].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
