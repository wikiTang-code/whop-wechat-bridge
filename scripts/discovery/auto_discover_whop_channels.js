import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');

// Parse .env manually to avoid extra dependencies
function loadEnv() {
  if (!fs.existsSync(envPath)) {
    console.error(`Error: Could not find .env file at ${envPath}`);
    return false;
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    // Strip optional quotes
    const cleanValue = value.replace(/^["']|["']$/g, '');
    process.env[key] = cleanValue;
  });
  return true;
}

// Parse Whop cookie string into Puppeteer cookie format
function parseCookies(str) {
  if (!str) return [];
  return str.split(';').map(pair => {
    const trimmed = pair.trim();
    if (!trimmed) return null;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return null;
    const name = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (!name || !value) return null; // Filter out invalid/empty pairs
    
    const cookie = {
      name,
      value,
      path: '/'
    };
    
    if (name.startsWith('__Host-')) {
      cookie.secure = true;
      cookie.url = 'https://whop.com';
    } else {
      cookie.domain = '.whop.com';
    }
    
    return cookie;
  }).filter(Boolean);
}

// Update the .env file with new channel IDs and mappings
function updateEnvFile(newFeeds, newMappings) {
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, 'utf-8');

  // 1. Update WHOP_CHAT_CHANNEL_ID
  const currentChannels = (process.env.WHOP_CHAT_CHANNEL_ID || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  
  const mergedChannels = [...new Set([...currentChannels, ...newFeeds])];
  const newChannelsStr = mergedChannels.join(',');

  if (content.includes('WHOP_CHAT_CHANNEL_ID=')) {
    content = content.replace(/^WHOP_CHAT_CHANNEL_ID=.*$/m, `WHOP_CHAT_CHANNEL_ID=${newChannelsStr}`);
  } else {
    content += `\nWHOP_CHAT_CHANNEL_ID=${newChannelsStr}`;
  }

  // 2. Update WHOP_CHANNEL_MAPPINGS
  let currentMappings = {};
  try {
    if (process.env.WHOP_CHANNEL_MAPPINGS) {
      currentMappings = JSON.parse(process.env.WHOP_CHANNEL_MAPPINGS);
    }
  } catch (err) {
    // ignore
  }

  const mergedMappings = { ...currentMappings, ...newMappings };
  const newMappingsStr = JSON.stringify(mergedMappings);

  if (content.includes('WHOP_CHANNEL_MAPPINGS=')) {
    content = content.replace(/^WHOP_CHANNEL_MAPPINGS=.*$/m, `WHOP_CHANNEL_MAPPINGS=${newMappingsStr}`);
  } else {
    content += `\nWHOP_CHANNEL_MAPPINGS=${newMappingsStr}`;
  }

  fs.writeFileSync(envPath, content, 'utf-8');
  console.log(`\n[Env Update] Successfully updated ${envPath}!`);
}

async function run() {
  if (!loadEnv()) return;

  const cookieStr = process.env.WHOP_COOKIE;
  
  // Accept experience URL from command line or fall back to default
  const args = process.argv.slice(2);
  const writeFlag = args.includes('--write') || args.includes('-w');
  
  let targetUrl = experienceUrlFromArgs(args) || 'https://whop.com/joined/38fcb263-06a0-4976-a687-016958e3b811/';
  
  if (!cookieStr) {
    console.error('Error: WHOP_COOKIE is not defined in your .env file.');
    return;
  }

  const parsedCookies = parseCookies(cookieStr);
  console.log(`Loaded cookies: ${parsedCookies.length} items`);
  console.log(`Target URL: ${targetUrl}`);

  console.log('Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Set cookies one-by-one to prevent a single invalid cookie from crashing the script
  for (const cookie of parsedCookies) {
    try {
      await page.setCookie(cookie);
    } catch (err) {
      console.warn(`  [Cookie Warning] Failed to set cookie [${cookie.name}]: ${err.message}`);
    }
  }

  const feedMapping = new Map();
  const feedNames = new Map();
  let currentTabPath = '';
  let currentTabName = '';

  await page.setRequestInterception(true);
  
  page.on('request', request => {
    const url = request.url();
    
    // Intercept GraphQL requests to find feedId or channelId in variables
    if (url.includes('api/graphql/') && request.method() === 'POST') {
      try {
        const postData = JSON.parse(request.postData() || '{}');
        const opName = postData.operationName || '';
        const vars = postData.variables || {};
        
        let feedId = null;
        if (vars.feedId) feedId = vars.feedId;
        else if (vars.channelId) feedId = vars.channelId;
        else if (vars.input?.feedId) feedId = vars.input.feedId;
        else if (vars.input?.channelId) feedId = vars.input.channelId;

        if (feedId && typeof feedId === 'string' && (feedId.startsWith('chat_feed_') || feedId.startsWith('forum_feed_'))) {
          console.log(`   🎯 [Intercepted] GraphQL ${opName}: ${feedId} for [${currentTabName}]`);
          feedMapping.set(currentTabPath, feedId);
          feedNames.set(feedId, currentTabName);
        }
      } catch (err) {}
    }
    
    // Intercept REST requests
    if (url.includes('/messages') && request.method() === 'GET') {
      try {
        const urlObj = new URL(url);
        const channelId = urlObj.searchParams.get('channel_id') || urlObj.searchParams.get('channelId');
        if (channelId && (channelId.startsWith('chat_feed_') || channelId.startsWith('forum_feed_'))) {
          console.log(`   🎯 [Intercepted] REST Channel ID: ${channelId} for [${currentTabName}]`);
          feedMapping.set(currentTabPath, channelId);
          feedNames.set(channelId, currentTabName);
        }
      } catch (err) {}
    }

    request.continue();
  });

  console.log('Opening group dashboard...');
  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('Scanning sidebar for channels...');
  const appLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/app/"]'));
    return links.map(a => {
      const href = a.getAttribute('href');
      const text = a.textContent.trim().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
      return { href, text };
    });
  });

  console.log(`Found ${appLinks.length} channels in sidebar.`);

  for (let i = 0; i < appLinks.length; i++) {
    const tab = appLinks[i];
    currentTabPath = tab.href;
    currentTabName = tab.text.replace(/^(.)\1/, '$1'); // clean Next.js double letter artifacts

    console.log(`\n[${i + 1}/${appLinks.length}] Navigating to channel [${currentTabName}]...`);
    const fullUrl = currentTabPath.startsWith('http') ? currentTabPath : `https://whop.com${currentTabPath}`;
    
    try {
      await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 3500));
    } catch (err) {
      console.error(`  Error loading [${currentTabName}]:`, err.message);
    }
  }

  console.log('\nClosing browser...');
  await browser.close();

  console.log('\n======================================');
  console.log('=== DISCOVERED CHANNEL MAPPINGS ===');
  
  const discoveredFeeds = [];
  const mappings = {};

  appLinks.forEach(tab => {
    const feedId = feedMapping.get(tab.href);
    const cleanedName = tab.text.replace(/^(.)\1/, '$1');
    if (feedId) {
      discoveredFeeds.push(feedId);
      mappings[feedId] = cleanedName;
      console.log(`✅ [${cleanedName}] -> ${feedId}`);
    } else {
      console.log(`❌ [${cleanedName}] -> Not a chat/forum channel (or failed to load)`);
    }
  });
  console.log('======================================');

  if (discoveredFeeds.length > 0) {
    if (writeFlag) {
      updateEnvFile(discoveredFeeds, mappings);
    } else {
      console.log('\n[Dry Run] Recommended additions (run with --write to apply automatically):');
      console.log(`  WHOP_CHAT_CHANNEL_ID additions: ${discoveredFeeds.join(',')}`);
      console.log(`  WHOP_CHANNEL_MAPPINGS JSON additions:\n${JSON.stringify(mappings, null, 2)}`);
    }
  } else {
    console.warn('\nWarning: No chat/forum channel IDs discovered.');
  }
}

function experienceUrlFromArgs(args) {
  for (const arg of args) {
    if (arg.startsWith('https://whop.com/')) {
      return arg;
    }
  }
  return null;
}

run().catch(console.error);
