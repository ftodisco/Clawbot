#!/usr/bin/env node
/**
 * Express Valet Services — Social Media Post Generator
 *
 * Generates 2 posts per day (Instagram + Facebook), each focused on a
 * different service. Optionally uses the Claude API to write fresh copy
 * and the OpenAI DALL·E API to generate a matching image.
 *
 * Usage:
 *   node generate.js              — generate today's posts
 *   node generate.js --preview    — print posts to console only (no API calls)
 *   node generate.js --service 3  — generate posts for service id 3
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");

const postsData = require("./posts-content.json");

const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, "output");
const USE_AI_GENERATION = process.env.USE_AI_GENERATION === "true";
const PREVIEW_MODE = process.argv.includes("--preview");

const serviceArg = process.argv.indexOf("--service");
const forcedServiceId = serviceArg !== -1 ? parseInt(process.argv[serviceArg + 1]) : null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTodayServiceIndex() {
  // Rotate through services based on the day of year so each day gets a
  // different service automatically and the cycle repeats.
  const dayOfYear = Math.floor(
    (new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000
  );
  return dayOfYear % postsData.services.length;
}

function formatPost(caption, hashtags) {
  return `${caption}\n\n${hashtags.join(" ")}`;
}

function ensureOutputDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

// ─── AI Post Generation (optional) ──────────────────────────────────────────

async function generateAIPost(service, platform) {
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are a professional social media copywriter for Express Valet Services (expressvaleteservices.com), a premium dry cleaning and laundry pickup & delivery company. Write engaging, warm, and persuasive social media posts that highlight the convenience and quality of the service. Always end with a call-to-action directing customers to expressvaleteservices.com.`;

  const userPrompt = `Write a ${platform} post about our "${service.service}" service.
Requirements:
- Approximately 700 characters in the caption body (not counting hashtags)
- Warm, friendly, and professional tone
- Include a relevant emoji at the start or end of key sentences
- End with a clear call-to-action linking to expressvaleteservices.com
- Then on a new line, provide exactly 4 relevant hashtags
- Format: [caption text]\n\n[#hashtag1 #hashtag2 #hashtag3 #hashtag4]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content[0].text;
}

// ─── Image Generation ────────────────────────────────────────────────────────

async function generateImage(service, outputDir) {
  const client = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

  console.log(`  Generating image for "${service.service}"...`);

  const response = await client.images.generate({
    model: "dall-e-3",
    prompt: service.image_prompt,
    n: 1,
    size: "1024x1024",
    quality: "standard",
    style: "natural",
  });

  const imageUrl = response.data[0].url;

  // Download and save the image
  const https = require("https");
  const fileName = `${dateStamp()}-${service.service.toLowerCase().replace(/\s+/g, "-")}.png`;
  const filePath = path.join(outputDir, fileName);

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(imageUrl, (res) => {
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", reject);
  });

  return { url: imageUrl, path: filePath };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  const idx = forcedServiceId != null
    ? postsData.services.findIndex((s) => s.id === forcedServiceId)
    : getTodayServiceIndex();

  const service = postsData.services[idx < 0 ? 0 : idx];

  console.log(`\n======================================================`);
  console.log(`  Express Valet Services — Social Media Posts`);
  console.log(`  Date   : ${dateStamp()}`);
  console.log(`  Service: ${service.service}`);
  console.log(`  Mode   : ${PREVIEW_MODE ? "Preview" : USE_AI_GENERATION ? "AI-generated" : "Pre-written"}`);
  console.log(`======================================================\n`);

  let igPost, fbPost;

  if (!PREVIEW_MODE && USE_AI_GENERATION) {
    console.log("Generating posts with Claude AI...\n");
    [igPost, fbPost] = await Promise.all([
      generateAIPost(service, "Instagram"),
      generateAIPost(service, "Facebook"),
    ]);
  } else {
    igPost = formatPost(service.instagram.caption, service.instagram.hashtags);
    fbPost = formatPost(service.facebook.caption, service.facebook.hashtags);
  }

  // ── Display ──
  console.log("📸  INSTAGRAM POST");
  console.log("──────────────────────────────────────────────────────");
  console.log(igPost);
  console.log();
  console.log("👍  FACEBOOK POST");
  console.log("──────────────────────────────────────────────────────");
  console.log(fbPost);
  console.log();
  console.log("🖼️   IMAGE PROMPT (for DALL·E / Midjourney)");
  console.log("──────────────────────────────────────────────────────");
  console.log(service.image_prompt);
  console.log();

  if (PREVIEW_MODE) {
    console.log("(Preview mode — nothing saved or sent.)");
    return;
  }

  // ── Save output ──
  const outDir = path.join(OUTPUT_DIR, dateStamp());
  ensureOutputDir(outDir);

  const outputData = {
    date: dateStamp(),
    service: service.service,
    instagram: igPost,
    facebook: fbPost,
    image_prompt: service.image_prompt,
  };

  const jsonPath = path.join(outDir, "posts.json");
  fs.writeFileSync(jsonPath, JSON.stringify(outputData, null, 2), "utf8");
  console.log(`Posts saved to: ${jsonPath}`);

  // ── Generate image if OpenAI key is set ──
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "your_openai_api_key_here") {
    try {
      const imageResult = await generateImage(service, outDir);
      console.log(`Image saved to: ${imageResult.path}`);
      outputData.image_path = imageResult.path;
      fs.writeFileSync(jsonPath, JSON.stringify(outputData, null, 2), "utf8");
    } catch (err) {
      console.warn(`Image generation failed: ${err.message}`);
      console.log(`Use the image prompt above with DALL·E, Midjourney, or Adobe Firefly.`);
    }
  } else {
    console.log("No OpenAI key set — image prompt saved for manual use.");
  }

  console.log("\nDone! Ready to post on Instagram and Facebook.");
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
