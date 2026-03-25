#!/usr/bin/env node
/**
 * Express Valet Services — Daily Social Media Scheduler
 *
 * Runs the post generator automatically every day at two configurable times.
 * Default schedule: 9:00 AM and 5:00 PM (server local time).
 *
 * Uses node-cron for scheduling.
 *
 * Usage:
 *   node scheduler.js
 */

require("dotenv").config();
const cron = require("node-cron");
const { execSync } = require("child_process");
const path = require("path");

const MORNING_TIME = process.env.MORNING_POST_TIME || "0 9 * * *";   // 9:00 AM
const EVENING_TIME = process.env.EVENING_POST_TIME || "0 17 * * *";  // 5:00 PM

const generateScript = path.join(__dirname, "generate.js");

function runGenerator(label) {
  const timestamp = new Date().toLocaleString();
  console.log(`\n[${timestamp}] Running ${label} post generation...`);
  try {
    const output = execSync(`node "${generateScript}"`, { encoding: "utf8" });
    console.log(output);
  } catch (err) {
    console.error(`Post generation failed: ${err.message}`);
  }
}

console.log("======================================================");
console.log("  Express Valet Services — Social Media Scheduler");
console.log("======================================================");
console.log(`  Morning post : ${MORNING_TIME} (cron)`);
console.log(`  Evening post : ${EVENING_TIME} (cron)`);
console.log("  Press Ctrl+C to stop.\n");

// Schedule morning post
cron.schedule(MORNING_TIME, () => runGenerator("Morning"), {
  scheduled: true,
  timezone: "America/New_York",
});

// Schedule evening post
cron.schedule(EVENING_TIME, () => runGenerator("Evening"), {
  scheduled: true,
  timezone: "America/New_York",
});

console.log("Scheduler is running. Waiting for scheduled times...");
