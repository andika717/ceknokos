const TelegramBot  = require('node-telegram-bot-api');
const puppeteer    = require('puppeteer-core');
const chromium     = require('@sparticuz/chromium');
const { execSync } = require('child_process');

const BOT_TOKEN        = process.env.BOT_TOKEN || '8872359667:AAGLyCMRTZjVVsaOXqduX24UPB27XZZKuGY';
const SHOPEE_RESET_URL = 'https://shopee.co.id/buyer/reset?scenario=7';
const UA = 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const EXTRA_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', '--disable-gpu',
  '--single-process', '--no-zygote',
];

const MAX_CONCURRENT     = 10;
const MAX_QUEUE_SIZE     = 50;
const TASK_TIMEOUT_MS    = 70000;
const BROWSER_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const RESULT_DELETE_MS   = 60000; // ← hapus pesan hasil setelah 1 menit

// Nomor test untuk debug (nomor acak, hanya untuk uji)
const DEBUG_PHONES = [
  '08111111111',
  '08222222222',
  '08333333333',
];

// ─── Queue ────────────────────────────────────────────────────────────────────
let activeChecks = 0;
const queue = [];

function processQueue() {
  while (activeChecks < MAX_CONCURRENT && queue.length > 0) {
    activeChecks++;
    const task = queue.shift();

    queue.forEach((t, i) => {
      if (t.chatId && t.loadingId) {
        bot.editMessageText(`⏳ ${t.sender} | Antrian ke-${i + 1}... (${maskPhone(t.phone)})`, {
          chat_id: t.chatId, message_id: t.loadingId,
        }).catch(() => {});
      }
    });

    runTask(task).finally(() => {
      activeChecks--;
      processQueue();
    });
  }
}

async function runTask(task) {
  const masked = maskPhone(task.phone);
  const start  = Date.now();
  console.log(`[CEK] Mulai → ${task.phone}`);

  try {
    const res   = await withTimeout(checkPhone(task.phone), TASK_TIMEOUT_MS);
    const exist = res?.data?.exist;
    const durasi = ((Date.now() - start) / 1000).toFixed(1);

    if (res.error === 0 && exist) {
      console.log(`[HASIL] ✅ TERDAFTAR   → ${task.phone} (${durasi}s)`);
    } else if (res.error === 0 && !exist) {
      console.log(`[HASIL] ❌ TIDAK DAFTAR → ${task.phone} (${durasi}s)`);
    } else {
      console.log(`[HASIL] ⚠️ ERROR ${res.error}    → ${task.phone} (${durasi}s)`);
    }

    const statusText = (res.error === 0 && exist)
      ? `✅ ${task.sender} | ${masked} — Terdaftar di Shopee`
      : (res.error === 0 && !exist)
        ? `❌ ${task.sender} | ${masked} — Tidak terdaftar`
        : `⚠️ ${task.sender} | ${masked} — Gagal cek (error ${res.error})`;

    if (task.chatId && task.loadingId) {
      await safeSend(() =>
        bot.editMessageText(statusText, { chat_id: task.chatId, message_id: task.loadingId })
      );
      // ← hapus pesan hasil setelah RESULT_DELETE_MS
      deleteAfter(task.chatId, task.loadingId, RESULT_DELETE_MS);
    }
  } catch (err) {
    const durasi = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[HASIL] ⚠️ GAGAL        → ${task.phone} | ${err.message} (${durasi}s)`);
    if (task.chatId && task.loadingId) {
      await safeSend(() =>
        bot.editMessageText(`⚠️ ${task.sender} | ${masked} — Gagal cek (timeout/error)`, {
          chat_id: task.chatId, message_id: task.loadingId,
        })
      ).catch(() => {});
      // ← hapus pesan hasil setelah RESULT_DELETE_MS
      deleteAfter(task.chatId, task.loadingId, RESULT_DELETE_MS);
    }
  }
}

// ─── Auto-delete helper ───────────────────────────────────────────────────────
function deleteAfter(chatId, messageId, ms) {
  setTimeout(() => {
    bot.deleteMessage(chatId, messageId).catch(() => {});
  }, ms);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

// ─── Browser ──────────────────────────────────────────────────────────────────
let browser              = null;
let browserBornAt        = 0;
let browserLaunchPromise = null;

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
  }
  const br = await puppeteer.launch({ headless: 'new', executablePath, args });
  br.on('disconnected', () => {
    console.warn('[Browser] Disconnected, akan restart saat dibutuhkan');
    browser = null;
    browserLaunchPromise = null;
  });
  console.log('[Browser] Ready, using:', systemChrome || 'sparticuz/chromium');
  return br;
}

async function getBrowser() {
  const now = Date.now();
  if (browser && browser.connected && (now - browserBornAt) > BROWSER_MAX_AGE_MS) {
    try { await browser.close(); } catch (_) {}
    browser = null;
    browserLaunchPromise = null;
  }
  if (browser && browser.connected) return browser;
  if (!browserLaunchPromise) {
    browserLaunchPromise = launchBrowser().then(br => {
      browser = br;
      browserBornAt = Date.now();
      return br;
    }).catch(err => {
      browserLaunchPromise = null;
      throw err;
    });
  }
  return browserLaunchPromise;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  if (phone.length <= 8) return phone;
  return phone.slice(0, 4) + '****' + phone.slice(-4);
}

function isBrowserError(err) {
  const msg = err.message || '';
  return (
    msg.includes('disconnected') ||
    msg.includes('Target closed') ||
    msg.includes('Navigation failed') ||
    msg.includes('Session closed') ||
    msg.includes('Protocol error')
  );
}

async function checkPhone(phone, attempt = 0) {
  const br   = await getBrowser();
  const page = await br.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 390, height: 844, isMobile: true });

    let apiResult = null;
    page.on('response', async res => {
      if (res.url().includes('check_account_exist')) {
        try { apiResult = await res.json(); } catch (_) {}
      }
    });

    await page.goto(SHOPEE_RESET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const input = await page.waitForSelector(
      'input[type="text"],input[type="tel"],input[type="email"],input',
      { timeout: 25000 }
    );
    if (!input) throw new Error('Input tidak ditemukan di halaman Shopee');

    await input.click({ clickCount: 3 });
    await input.type(phone, { delay: 50 });
    await sleep(1000);
    await page.keyboard.press('Enter');

    for (let i = 0; i < 40 && !apiResult; i++) {
      await sleep(500);
    }

    if (!apiResult) throw new Error('Timeout: tidak ada respons dari Shopee');
    return apiResult;
  } catch (err) {
    if (isBrowserError(err) && attempt < 2) {
      browser = null;
      browserLaunchPromise = null;
      await sleep(2000);
      return checkPhone(phone, attempt + 1);
    }
    throw err;
  } finally {
    try { await page.close(); } catch (_) {}
  }
}

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

// ─── Debug Test: 7 nomor sekaligus ke console ─────────────────────────────────
async function runDebugTest() {
  console.log('');
  console.log('════════════════════════════════════');
  console.log(' DEBUG TEST — 7 nomor sekaligus     ');
  console.log('════════════════════════════════════');
  console.log(`Paralel maks: ${MAX_CONCURRENT} | Total nomor: ${DEBUG_PHONES.length}`);
  console.log('');

  const startAll = Date.now();
  DEBUG_PHONES.forEach(phone => {
    queue.push({ phone, chatId: null, loadingId: null });
  });
  processQueue();

  // Tunggu sampai semua selesai
  while (activeChecks > 0 || queue.length > 0) {
    await sleep(500);
  }

  const totalDurasi = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log('');
  console.log(`════════ SELESAI dalam ${totalDurasi}s ════════`);
  console.log('');
}

// ─── Bot ──────────────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, {
  polling: { interval: 1000, autoStart: true, params: { timeout: 10 } },
});

console.log(`Bot started — max ${MAX_CONCURRENT} paralel, antrian maks ${MAX_QUEUE_SIZE}`);

// Inisialisasi browser lalu langsung debug test
getBrowser()
  .then(() => runDebugTest())
  .catch(e => console.error('[Browser] Init failed:', e.message));

bot.on('message', async (msg) => {
  const text   = msg.text || '';
  const chatId = msg.chat.id;

  if (!text) return;

  if (msg.chat.type === 'private') return;

  const phones = extractPhones(text);
  if (phones.length === 0) return;

  try { await bot.deleteMessage(chatId, msg.message_id); } catch (_) {}

  const sender = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || 'User');

  for (const phone of phones) {
    const masked = maskPhone(phone);

    if (queue.length + activeChecks >= MAX_QUEUE_SIZE) {
      await safeSend(() =>
        bot.sendMessage(chatId, `🚫 ${sender} | ${masked} — Antrian penuh (maks ${MAX_QUEUE_SIZE}), coba lagi nanti`)
      ).catch(() => {});
      continue;
    }

    const posisiAntrian   = queue.length;
    const sedangDiproses  = activeChecks < MAX_CONCURRENT && posisiAntrian === 0;
    const teks = sedangDiproses
      ? `🔍 ${sender} | Mengecek ${masked}...`
      : `⏳ ${sender} | Antrian ke-${posisiAntrian + 1}... (${masked})`;

    let loadingId = null;
    try {
      const loadMsg = await safeSend(() => bot.sendMessage(chatId, teks));
      loadingId = loadMsg?.message_id;
    } catch (_) { continue; }

    queue.push({ phone, chatId, loadingId, sender });
    processQueue();
  }
});

bot.on('polling_error', (err) => {
  const msg = err.message || '';
  if (!msg.includes('502') && !msg.includes('429')) {
    console.error('[Polling Error]', msg);
  }
});

process.on('unhandledRejection', (err) => {
  console.error('[Unhandled Rejection]', err?.message || err);
});

process.on('SIGTERM', async () => {
  console.log('[SIGTERM] Menutup browser...');
  if (browser) try { await browser.close(); } catch (_) {}
  process.exit(0);
});
