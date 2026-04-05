/**
 * scheduler.js
 * Runs the pipeline on a daily cron schedule.
 *
 * Usage:
 *   npm run schedule              — start the scheduler
 *   npm run schedule -- --run-now — also run immediately on start
 *
 * Schedule is read from (in priority order):
 *   1. UPLOAD_SCHEDULE env var
 *   2. config/niche.json → channel.uploadSchedule
 *   3. Default: "0 9 * * *" (9:00 AM UTC daily)
 */

import 'dotenv/config';
import cron from 'node-cron';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runPipeline } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const niche = JSON.parse(readFileSync(join(__dirname, '../config/niche.json'), 'utf-8'));

const schedule = process.env.UPLOAD_SCHEDULE
  || niche.channel.uploadSchedule
  || '0 9 * * *';

if (!cron.validate(schedule)) {
  console.error(`❌ Invalid cron expression: "${schedule}"`);
  process.exit(1);
}

console.log('\n' + '═'.repeat(60));
console.log('  ⏰  Clawbot Scheduler');
console.log('═'.repeat(60));
console.log(`  Channel  : ${niche.channel.name}`);
console.log(`  Schedule : ${schedule}  (${describeCron(schedule)})`);
console.log(`  Next run : ${getNextRun(schedule)}`);
console.log('  Press Ctrl+C to stop');
console.log('═'.repeat(60) + '\n');

cron.schedule(schedule, async () => {
  console.log(`\n⏰ Scheduled run triggered at ${new Date().toLocaleString()}`);
  try {
    await runPipeline();
  } catch (err) {
    console.error('❌ Scheduled run failed:', err.message);
  }
}, { timezone: 'UTC' });

// Optional immediate run on startup
if (process.argv.includes('--run-now')) {
  console.log('🚀 --run-now flag detected. Starting pipeline now...\n');
  runPipeline().catch(err => console.error('❌ Immediate run failed:', err.message));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function describeCron(expr) {
  const [min, hour, dom, month, dow] = expr.split(' ');
  if (dom === '*' && month === '*' && dow === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;
  }
  return `Custom schedule: ${expr}`;
}

function getNextRun(expr) {
  // Simple approximation — just show when it would next fire today or tomorrow
  const [min, hour] = expr.split(' ').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, min, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toUTCString();
}
