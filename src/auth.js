/**
 * auth.js
 * One-time OAuth2 setup to obtain a YouTube refresh token.
 * Run with: npm run auth
 *
 * Steps:
 *  1. Enter your Google Cloud OAuth2 credentials
 *  2. Open the generated URL in your browser
 *  3. Grant access and copy the authorization code
 *  4. Paste the code here — refresh token is saved to .youtube-credentials.json
 */

import { google } from 'googleapis';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = join(__dirname, '../.youtube-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));

  console.log('\n' + '═'.repeat(60));
  console.log('  🔐  YouTube OAuth2 Setup — Clawbot');
  console.log('═'.repeat(60));

  let clientId, clientSecret;

  // Re-use existing credentials if available
  if (existsSync(CREDENTIALS_PATH)) {
    const saved = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
    if (saved.refresh_token) {
      console.log('\n✅ Credentials already configured.');
      const ans = await ask('   Re-authenticate? (y/N): ');
      if (ans.trim().toLowerCase() !== 'y') { rl.close(); return; }
    }
    clientId = saved.client_id;
    clientSecret = saved.client_secret;
  }

  if (!clientId) {
    console.log('\nYou need a Google Cloud project with the YouTube Data API v3 enabled.');
    console.log('Setup guide:');
    console.log('  1. Visit https://console.cloud.google.com');
    console.log('  2. Create (or select) a project');
    console.log('  3. APIs & Services → Enable "YouTube Data API v3"');
    console.log('  4. APIs & Services → Credentials → Create OAuth 2.0 Client ID');
    console.log('  5. Application type: Desktop app');
    console.log('  6. Copy the Client ID and Client Secret below\n');

    clientId     = (await ask('Client ID:     ')).trim();
    clientSecret = (await ask('Client Secret: ')).trim();
  }

  const redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n📱 Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nAfter granting access, you will see a code on the page.\n');

  const code = (await ask('Paste the authorization code: ')).trim();

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error('\n❌ No refresh token received.');
    console.error('   Make sure you selected "Allow" and that the app is set to "prompt: consent".');
    rl.close();
    process.exit(1);
  }

  writeFileSync(CREDENTIALS_PATH, JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [redirectUri],
    refresh_token: tokens.refresh_token,
  }, null, 2));

  console.log('\n✅ Authentication complete! Credentials saved to .youtube-credentials.json');
  console.log('   Run `npm start` to generate and upload your first video.\n');
  rl.close();
}

main().catch(err => {
  console.error('Auth error:', err.message);
  process.exit(1);
});
