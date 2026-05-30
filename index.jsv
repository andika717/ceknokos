const TelegramBot  = require('node-telegram-bot-api');
const puppeteer    = require('puppeteer-core');
const chromium     = require('@sparticuz/chromium');
const axios        = require('axios');
const { execSync } = require('child_process');

const BOT_TOKEN        = '8872359667:AAGLyCMRTZjVVsaOXqduX24UPB27XZZKuGY';
const SHOPEE_RESET_URL = 'https://shopee.co.id/buyer/reset?scenario=7';
const TOKOPEDIA_URL    = 'https://www.tokopedia.com/reset-password';

const UA = 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const EXTRA_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', '--disable-gpu',
  '--no-zygote',
];

const BROWSER_MAX_AGE_MS  = 2 * 60 * 60 * 1000;
const COOKIE_TTL_MS       = 8 * 60 * 1000;       // refresh cookies setiap 8 menit
const MAX_QUEUE_SIZE      = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizePhone(raw) {
  let p = raw.replace(/[^\d+]/g, '');
  if (p.startsWith('+62'))                      p = '0' + p.slice(3);
  else if (p.startsWith('62') && p.length > 10) p = '0' + p.slice(2);
  return p;
}

function extractPhones(text) {
  const matches = text.match(/(?:\+62|62|0)[0-9\-\s]{8,14}/g) || [];
  return [...new Set(
    matches.map(m => normalizePhone(m))
           .filter(p => p.startsWith('0') && p.length >= 9 && p.length <= 14)
  )];
}

function maskPhone(phone) {
  if (phone.length <= 6) return phone;
  const start = Math.floor((phone.length - 5) / 2);
  return phone.slice(0, start) + '*****' + phone.slice(start + 5);
}

function isBrowserError(err) {
  const msg = err.message || '';
  return (
    msg.includes('disconnected') ||
    msg.includes('Target closed') ||
    msg.includes('Navigation failed') ||
    msg.includes('Session closed') ||
    msg.includes('Protocol error') ||
    msg.includes('frame was detached') ||
    msg.includes('Navigating frame was detached') ||
    msg.includes('ERR_HTTP2') ||
    msg.includes('net::ERR')
  );
}

// ─── Browser ──────────────────────────────────────────────────────────────────
let browser        = null;
let browserBornAt  = 0;
let browserLaunching = false;

function getSystemChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']) {
    try { return execSync(`which ${bin}`).toString().trim(); } catch (_) {}
  }
  return null;
}

async function launchBrowser() {
  const systemChrome = getSystemChromePath();
  let executablePath, args;
  if (systemChrome) {
    executablePath = systemChrome;
    args = EXTRA_ARGS;
  } else {
    executablePath = await chromium.executablePath();
    args = [...chromium.args, ...EXTRA_ARGS];
    chromium.setHeadlessMode = true;
  }
  const br = await puppeteer.launch({
    headless: systemChrome ? 'new' : chromium.headless,
    executablePath,
    args,
  });
  br.on('disconnected', () => { browser = null; });
  console.log('[Browser] Ready, using:', systemChrome || 'sparticuz/chromium');
  return br;
}

async function getBrowser() {
  const now = Date.now();
  if (browser && browser.connected && (now - browserBornAt) > BROWSER_MAX_AGE_MS) {
    try { await browser.close(); } catch (_) {}
    browser = null;
  }
  if (browser && browser.connected) return browser;
  if (browserLaunching) {
    await sleep(1000);
    return getBrowser();
  }
  browserLaunching = true;
  try {
    if (browser) { try { await browser.close(); } catch (_) {} }
    browser = await launchBrowser();
    browserBornAt = Date.now();
  } finally {
    browserLaunching = false;
  }
  return browser;
}

// ─── Tokopedia Cookie Cache ────────────────────────────────────────────────────
let tkpdCookieStr   = null;
let tkpdCookieAt    = 0;
let tkpdCookieLoading = false;

async function getTkpdCookies() {
  const now = Date.now();
  if (tkpdCookieStr && (now - tkpdCookieAt) < COOKIE_TTL_MS) return tkpdCookieStr;
  if (tkpdCookieLoading) {
    await sleep(500);
    return getTkpdCookies();
  }
  tkpdCookieLoading = true;
  try {
    const br   = await getBrowser();
    const page = await br.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 390, height: 844, isMobile: true });

    // Blokir resource tidak perlu supaya lebih cepat
    await page.setRequestInterception(true);
    const blocked = new Set(['image', 'media', 'font']);
    page.on('request', req => blocked.has(req.resourceType()) ? req.abort() : req.continue());

    await page.goto(TOKOPEDIA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);
    const cookies = await page.cookies();
    tkpdCookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    tkpdCookieAt  = Date.now();
    await page.close().catch(() => {});
    console.log('[Tokopedia] Cookies refreshed');
    return tkpdCookieStr;
  } catch (err) {
    tkpdCookieLoading = false;
    throw err;
  } finally {
    tkpdCookieLoading = false;
  }
}

// ─── Shopee Check (Puppeteer) ─────────────────────────────────────────────────
async function checkShopee(phone, attempt = 0) {
  const br   = await getBrowser();
  const page = await br.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 390, height: 844, isMobile: true });

    // Blokir resource tidak perlu
    await page.setRequestInterception(true);
    const blocked = new Set(['image', 'media', 'font']);
    page.on('request', req => blocked.has(req.resourceType()) ? req.abort() : req.continue());

    let apiResult = null;
    page.on('response', async res => {
      if (res.url().includes('check_account_exist')) {
        try { apiResult = await res.json(); } catch (_) {}
      }
    });

    await page.goto(SHOPEE_RESET_URL, { waitUntil: 'networkidle2', timeout: 40000 });

    // Tunggu sampai input benar-benar muncul (React butuh waktu render)
    let input;
    try {
      input = await page.waitForSelector(
        'input[type="text"],input[type="tel"],input[type="email"],input',
        { timeout: 10000 }
      );
    } catch (_) {
      throw new Error('Input tidak ditemukan di halaman Shopee');
    }

    await input.click({ clickCount: 3 });
    await input.type(phone, { delay: 60 });
    await sleep(1200);
    await page.keyboard.press('Enter');

    for (let i = 0; i < 24 && !apiResult; i++) await sleep(500);
    if (!apiResult) throw new Error('Timeout: tidak ada respons dari Shopee');
    return apiResult;
  } catch (err) {
    if (isBrowserError(err) && attempt < 2) {
      browser = null;
      tkpdCookieStr = null;
      await sleep(2000);
      return checkShopee(phone, attempt + 1);
    }
    throw err;
  } finally {
    try { await page.close(); } catch (_) {}
  }
}

// ─── Tokopedia Check (Cookies Cache + Axios) ──────────────────────────────────
async function checkTokopedia(phone, attempt = 0) {
  try {
    const cookieStr = await getTkpdCookies();

    const payload = [{
      operationName: 'resetPassword',
      variables: { input: { emailphone: phone } },
      query: `mutation resetPassword($input: ResetPasswordRequest!) {\n  resetPassword(input: $input) {\n    is_success\n    message\n    __typename\n  }\n}`,
    }];

    const res = await axios.post(
      'https://gql.tokopedia.com/graphql/resetPassword',
      payload,
      {
        headers: {
          'User-Agent'         : UA,
          'Content-Type'       : 'application/json',
          'x-source'           : 'tokopedia-lite',
          'x-tkpd-lite-service': 'atreus',
          'x-version'          : 'de4b90f',
          'x-device'           : 'lite-0.0',
          'Referer'            : TOKOPEDIA_URL,
          'Origin'             : 'https://www.tokopedia.com',
          'Accept'             : '*/*',
          'cookie'             : cookieStr,
        },
        timeout: 12000,
      }
    );

    const data = res.data;
    const arr  = Array.isArray(data) ? data[0] : data;
    const rp   = arr?.data?.resetPassword;

    if (!rp) throw new Error('Respons tidak valid dari Tokopedia');

    if (rp.is_success === true)  return true;
    if (rp.is_success === false) return false;
    throw new Error(`Respons tidak dikenal: ${JSON.stringify(rp)}`);
  } catch (err) {
    const msg = err.message || '';
    console.error(`[Tokopedia] ${phone} attempt=${attempt}:`, msg);

    // Cookies kadaluarsa / diblokir — paksa refresh
    const needRefresh = err.response?.status === 403 ||
                        err.response?.status === 401 ||
                        msg.includes('403') ||
                        msg.includes('401') ||
                        msg.includes('Respons tidak valid');
    if (needRefresh) tkpdCookieStr = null;

    if (attempt < 2) {
      await sleep(2000);
      return checkTokopedia(phone, attempt + 1);
    }
    throw err;
  }
}

// ─── Queue ────────────────────────────────────────────────────────────────────
let activeChecks = 0;
const queue      = [];

async function processQueue() {
  if (activeChecks > 0 || queue.length === 0) return;
  activeChecks++;
  const task = queue.shift();

  queue.forEach((t, i) => {
    bot.editMessageText(`⏳ Antrian ke-${i + 1}...`, {
      chat_id: t.chatId, message_id: t.loadingId,
    }).catch(() => {});
  });

  try {
    const [shopeeRes, tkpdRes] = await Promise.allSettled([
      withTimeout(checkShopee(task.phone), 50000, 'Shopee'),
      withTimeout(checkTokopedia(task.phone), 30000, 'Tokopedia'),
    ]);

    const masked = maskPhone(task.phone);

    // Shopee result
    let shopeeStatus;
    if (shopeeRes.status === 'fulfilled') {
      const r = shopeeRes.value;
      if (r.error === 0 && r?.data?.exist)  shopeeStatus = '✅ Terdaftar';
      else if (r.error === 0)               shopeeStatus = '❌ Tidak terdaftar';
      else                                  shopeeStatus = `⚠️ Error (${r.error})`;
    } else {
      console.error('[Shopee] rejected:', shopeeRes.reason?.message);
      shopeeStatus = '⚠️ Gagal cek';
    }

    // Tokopedia result
    let tkpdStatus;
    if (tkpdRes.status === 'fulfilled') {
      const r = tkpdRes.value;
      if (r === true)       tkpdStatus = '✅ Terdaftar';
      else if (r === false) tkpdStatus = '❌ Tidak terdaftar';
      else                  tkpdStatus = '⚠️ Gagal cek';
    } else {
      console.error('[Tokopedia] rejected:', tkpdRes.reason?.message);
      tkpdStatus = '⚠️ Gagal cek';
    }

    const text =
      `📱 ${masked}\n` +
      `Shopee    : ${shopeeStatus}\n` +
      `Tokopedia : ${tkpdStatus}`;

    await safeSend(() =>
      bot.editMessageText(text, { chat_id: task.chatId, message_id: task.loadingId })
    );
  } catch (err) {
    console.error('[queue] error:', err.message);
    try {
      await bot.editMessageText(`⚠️ ${maskPhone(task.phone)} — Gagal cek`, {
        chat_id: task.chatId, message_id: task.loadingId,
      });
    } catch (_) {}
  } finally {
    activeChecks--;
    processQueue();
  }
}

// ─── safeSend ─────────────────────────────────────────────────────────────────
async function safeSend(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message || '';
      const is429 = msg.includes('429');
      const is502 = msg.includes('502');
      if ((is429 || is502) && i < retries - 1) {
        await sleep(is429 ? 10000 : 3000);
      } else {
        throw err;
      }
    }
  }
}

// ─── Bot ──────────────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, {
  polling: { interval: 1000, autoStart: true, params: { timeout: 10 } },
});
console.log('Bot started');

// Pre-warm: browser + Tokopedia cookies saat startup
getBrowser()
  .then(() => getTkpdCookies())
  .catch(e => console.error('[Init] failed:', e.message));

bot.on('message', async (msg) => {
  const text   = msg.text || '';
  const chatId = msg.chat.id;

  if (!text) return;

  const chatType = msg.chat.type;
  if (chatType === 'private') return;

  const phones = extractPhones(text);
  if (phones.length === 0) return;

  try { await bot.deleteMessage(chatId, msg.message_id); } catch (_) {}

  for (const phone of phones) {
    const masked = maskPhone(phone);

    if (queue.length >= MAX_QUEUE_SIZE) {
      await safeSend(() =>
        bot.sendMessage(chatId, `🚫 ${masked} — Antrian penuh, coba lagi nanti`)
      ).catch(() => {});
      continue;
    }

    const posisi = activeChecks > 0 ? queue.length + 1 : 0;
    const teks   = posisi === 0
      ? `🔍 Mengecek ${masked}...`
      : `⏳ Antrian ke-${posisi}... (${masked})`;

    let loadingId = null;
    try {
      const loadMsg = await safeSend(() => bot.sendMessage(chatId, teks));
      loadingId = loadMsg?.message_id;
    } catch (_) { continue; }

    queue.push({ phone, chatId, loadingId });
    processQueue();
  }
});

bot.on('polling_error', (err) => {
  const msg = err.message || '';
  if (!msg.includes('502') && !msg.includes('429')) {
    console.error('Polling error:', msg);
  }
});

process.on('unhandledRejection', (err) => console.error('Unhandled:', err?.message));
process.on('SIGTERM', async () => {
  if (browser) try { await browser.close(); } catch (_) {}
  process.exit(0);
});
