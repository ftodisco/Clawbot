/**
 * content-generator.js
 * Generates a complete YouTube video package (title, description, tags, script).
 *
 * Provider selection (in priority order):
 *   1. OpenRouter  — set OPENROUTER_API_KEY  (any model via openrouter.ai)
 *   2. Anthropic   — set ANTHROPIC_API_KEY   (direct API, claude-opus-4-6)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const niche = JSON.parse(readFileSync(join(__dirname, '../config/niche.json'), 'utf-8'));

/**
 * Generate a complete YouTube video content package.
 * @param {string[]} previousTitles - Recently used titles to avoid repetition
 * @returns {Promise<object>} Content object with title, description, tags, script, etc.
 */
export async function generateContent(previousTitles = []) {
  const useOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const provider = useOpenRouter ? 'OpenRouter' : 'Anthropic';
  const model = useOpenRouter
    ? (process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-4')
    : 'claude-opus-4-6';

  console.log(`🤖 Generating content via ${provider} (${model})...`);

  const prompt = buildPrompt(previousTitles);

  const text = useOpenRouter
    ? await callOpenRouter(prompt, model)
    : await callAnthropic(prompt);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`${provider} did not return valid JSON.\n${text.slice(0, 400)}`);
  }

  const content = JSON.parse(jsonMatch[0]);
  content.fullScript = buildFullScript(content.script);
  content.isShort = niche.videoStyle.videoDuration === 'short';

  console.log(`✅ Content generated: "${content.title}"`);
  console.log(`   Topic: ${content.topic}`);
  console.log(`   Script: ~${content.fullScript.split(' ').length} words`);

  return content;
}

// ─── Provider: OpenRouter (OpenAI-compatible) ─────────────────────────────────

async function callOpenRouter(prompt, model) {
  const { default: OpenAI } = await import('openai');

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/ftodisco/Clawbot',
      'X-Title': 'Clawbot YouTube Automation',
    },
  });

  const stream = await client.chat.completions.create({
    model,
    max_tokens: 8000,
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  });

  let text = '';
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta?.content || '';
  }
  return text;
}

// ─── Provider: Anthropic (direct) ────────────────────────────────────────────

async function callAnthropic(prompt) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stream = await client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });

  const response = await stream.finalMessage();

  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(previousTitles) {
  const isShort = niche.videoStyle.videoDuration === 'short';
  const topicsList = niche.topics.map(t => `- ${t}`).join('\n');
  const avoidSection = previousTitles.length > 0
    ? `\nRecently used titles to AVOID:\n${previousTitles.map(t => `- ${t}`).join('\n')}`
    : '';

  const formatGuide = isShort
    ? 'YouTube Short (vertical, under 60 seconds). Script must be ~100–130 words total. Add "#Shorts" at end of title.'
    : 'Regular YouTube video (5–8 minutes). Script must be ~900–1200 words total across all sections.';

  return `You are a YouTube content creator for the channel "${niche.channel.name}".

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
  "description": "Full YouTube description 300–500 words. Include:\\n\\n📌 What you'll learn:\\n- Point 1\\n- Point 2\\n\\n🔗 Resources:\\n[LINKS]\\n\\n${niche.seo.baseHashtags.join(' ')} #RelevantTag1 #RelevantTag2",
  "tags": ["15", "to", "20", "relevant", "tags", "as", "an", "array"],
  "thumbnail_text": "Bold 3–5 word thumbnail headline in ALL CAPS",
  "topic": "The specific topic you chose",
  "category_id": "28",
  "script": {
    "hook": "Attention-grabbing opening sentence (~20 words of spoken text)",
    "intro": "Brief intro: who this is for and what they will learn (~30 words)",
    "sections": [
      {
        "title": "Section heading",
        "content": "Spoken script for this section. Conversational and specific.",
        "duration_seconds": 30
      }
    ],
    "outro": "Call to action: ${niche.videoStyle.callToAction} (~20 words)"
  }
}

Requirements:
- Script must be natural spoken language, not bullet points
- Include specific technical details (commands, API names, file paths where relevant)
- Hook must immediately answer a question or solve a problem
- Tags should mix broad and specific terms`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFullScript(script) {
  if (!script) return '';
  return [
    script.hook,
    script.intro,
    ...(script.sections || []).map(s => s.content),
    script.outro,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
