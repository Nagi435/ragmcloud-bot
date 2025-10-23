// =======================================================
//  رقم كلاود ERP WhatsApp Sales System (Multi-User)
//  - Auth (JWT + SQLite)
//  - Per-User WhatsApp Sessions
//  - DeepSeek AI + Arabic Sales Replies
//  - Per-User Memory, Bulk Send, and Reports
// =======================================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

// -------------------------------------------------------
// App & IO
// -------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 60000
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure folders
['uploads', 'memory', 'tmp', 'reports', 'sessions', 'public'].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// -------------------------------------------------------
// Database (SQLite) for users
// -------------------------------------------------------
const db = new sqlite3.Database(path.join(__dirname, 'users.db'));
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','standard'))
    )
  `);
  // seed admin
  db.get('SELECT id FROM users WHERE username=?', ['IT'], (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync('@Admin4004', 10);
      db.run(
        'INSERT INTO users(username, password_hash, role) VALUES(?,?,?)',
        ['IT', hash, 'admin'],
        e => e ? console.error('Seed admin error:', e) : console.log('✅ Admin (IT/@Admin4004) created')
      );
    }
  });
});

const JWT_SECRET = process.env.JWT_SECRET || 'ragmcloud_secret_2025';

// -------------------------------------------------------
// Auth helpers
// -------------------------------------------------------
function signToken(u) {
  return jwt.sign({ username: u.username, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(403).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

// -------------------------------------------------------
// Auth routes
// -------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username & password required' });

  db.get('SELECT * FROM users WHERE username=?', [username], (err, user) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    const redirect = user.role === 'admin' ? '/admin.html' : `/dashboard_${user.username}.html`;
    res.json({ success: true, token, role: user.role, redirect });
  });
});

app.get('/api/me', verifyToken, (req, res) => res.json({ success: true, user: req.user }));

app.get('/api/users', verifyToken, adminOnly, (req, res) => {
  db.all('SELECT id, username, role FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ users: rows });
  });
});

app.post('/api/users', verifyToken, adminOnly, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  const hash = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users(username, password_hash, role) VALUES(?,?,?)',
    [username, hash, role],
    err => {
      if (err) return res.status(400).json({ error: 'User exists' });
      // create empty dashboard file if missing (optional)
      const dash = path.join(__dirname, 'public', `dashboard_${username}.html`);
      if (!fs.existsSync(dash)) {
        fs.writeFileSync(dash, `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>لوحة ${username}</title><script src="/socket.io/socket.io.js"></script></head><body><h2>لوحة ${username}</h2><div id="status"></div><div id="qr"></div><script>
const token=localStorage.getItem('token'); if(!token) location='/';
const u='${username}'; const s=io();
s.emit('join',{username:u});
s.on('status_'+u,(st)=>{document.getElementById('status').innerText=st.message});
s.on('qr_'+u,(p)=>{document.getElementById('qr').innerHTML='<img style="width:260px" src=\"'+p.qr+'\"/>'});
s.emit('start_whatsapp',{username:u});
</script></body></html>`);
      }
      res.json({ success: true, message: 'User created' });
    });
});

// -------------------------------------------------------
// Static pages
// -------------------------------------------------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/dashboard/:username', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', `dashboard_${req.params.username}.html`));
});

// -------------------------------------------------------
// Multer upload
// -------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// =======================================================
// DeepSeek + Company
// =======================================================
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const deepseekAvailable = !!DEEPSEEK_KEY;

const ragmcloudCompanyInfo = {
  name: "رقم كلاود", englishName: "Ragmcloud ERP",
  website: "https://ragmcloud.sa", phone: "+966555111222",
  email: "info@ragmcloud.sa", address: "الرياض - حي المغرزات - طريق الملك عبد الله",
  workingHours: "من الأحد إلى الخميس - 8 صباحاً إلى 6 مساءً",
};

const AI_SYSTEM_PROMPT = `أنت مساعد ذكي ومحترف تمثل شركة "رقم كلاود" المتخصصة في أنظمة ERP السحابية...
(نفس إرشاداتك عن الهوية، الباقات، قواعد الرد، الأمثلة المقنعة، طريقة الحوار)`.trim();

// =======================================================
// Per-user state (clients, qr/status, performance)
// =======================================================
const clientsByUser = new Map();          // username -> whatsapp Client
const qrByUser = new Map();               // username -> last QR dataURL
const isConnectedByUser = new Map();      // username -> boolean
const botStoppedByUser = new Map();       // username -> boolean
const performanceByUser = new Map();      // username -> { dailyStats, clientInteractions, messageHistory }

// --------- performance helpers per user ----------
function ensurePerf(username) {
  if (!performanceByUser.has(username)) {
    const today = new Date().toISOString().split('T')[0];
    performanceByUser.set(username, {
      dailyStats: {
        date: today, messagesSent: 0, clientsContacted: 0,
        aiRepliesSent: 0, bulkCampaigns: 0, interestedClients: 0,
        startTime: new Date().toISOString(), lastActivity: new Date().toISOString()
      },
      clientInteractions: new Map(),
      messageHistory: []
    });
    loadPerformanceData(username);
  }
  return performanceByUser.get(username);
}
function savePerformanceData(username) {
  try {
    const p = ensurePerf(username);
    const data = {
      ...p,
      clientInteractions: Array.from(p.clientInteractions.entries())
    };
    const dir = path.join(__dirname, 'memory', username);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'employee_performance.json'), JSON.stringify(data, null, 2));
  } catch (e) { console.error('savePerformanceData error:', e); }
}
function loadPerformanceData(username) {
  try {
    const dir = path.join(__dirname, 'memory', username, 'employee_performance.json');
    if (fs.existsSync(dir)) {
      const data = JSON.parse(fs.readFileSync(dir, 'utf8'));
      performanceByUser.set(username, {
        ...data,
        clientInteractions: new Map(data.clientInteractions || [])
      });
    }
    // day rollover
    const p = performanceByUser.get(username);
    const today = new Date().toISOString().split('T')[0];
    if (p.dailyStats.date !== today) {
      p.dailyStats = {
        date: today, messagesSent: 0, clientsContacted: 0, aiRepliesSent: 0,
        bulkCampaigns: 0, interestedClients: 0, startTime: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      };
      p.clientInteractions = new Map();
      p.messageHistory = [];
      savePerformanceData(username);
    }
  } catch { /* ignore */ }
}
function trackEmployeeActivity(username, type, data = {}) {
  const p = ensurePerf(username);
  p.dailyStats.lastActivity = new Date().toISOString();
  switch (type) {
    case 'message_sent':
      p.dailyStats.messagesSent++;
      if (!p.clientInteractions.has(data.clientPhone)) {
        p.dailyStats.clientsContacted++;
        p.clientInteractions.set(data.clientPhone, { firstContact: new Date().toISOString(), messageCount: 0, lastMessage: new Date().toISOString(), interested: false });
      }
      p.clientInteractions.get(data.clientPhone).messageCount++;
      p.clientInteractions.get(data.clientPhone).lastMessage = new Date().toISOString();
      break;
    case 'ai_reply':
      p.dailyStats.aiRepliesSent++; break;
    case 'bulk_campaign':
      p.dailyStats.bulkCampaigns++; break;
    case 'client_interested':
      p.dailyStats.interestedClients++;
      if (p.clientInteractions.has(data.clientPhone)) {
        p.clientInteractions.get(data.clientPhone).interested = true;
      }
      break;
  }
  p.messageHistory.push({ timestamp: new Date().toISOString(), type, ...data });
  savePerformanceData(username);
}

// =======================================================
// Per-user memory
// =======================================================
function storeClientMessageForUser(username, phone, message, fromMe) {
  try {
    const dir = path.join(__dirname, 'memory', username);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `messages_${phone}.json`);
    let arr = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    arr.push({ message, fromMe, timestamp: new Date().toISOString() });
    if (arr.length > 50) arr = arr.slice(-50);
    fs.writeFileSync(file, JSON.stringify(arr, null, 2));
  } catch (e) { console.error('storeClientMessageForUser error:', e); }
}
function getClientMessagesForUser(username, phone) {
  try {
    const file = path.join(__dirname, 'memory', username, `messages_${phone}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return [];
}
function updateClientLastMessageForUser(username, phone, message) {
  try {
    const clientsFile = path.join(__dirname, 'memory', username, 'clients.json');
    let clients = [];
    if (fs.existsSync(clientsFile)) clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
    const i = clients.findIndex(c => c.phone === phone);
    if (i !== -1) {
      clients[i].lastMessage = message.substring(0, 50) + (message.length > 50 ? '...' : '');
      clients[i].lastActivity = new Date().toISOString();
      fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
      io.emit(`clients_updated_${username}`, clients);
    }
  } catch (e) { console.error('updateClientLastMessageForUser error:', e); }
}

// =======================================================
// Greeting / context helpers
// =======================================================
function shouldSendGreeting(username, phone) {
  const messages = getClientMessagesForUser(username, phone);
  if (messages.length === 0) return true;
  const last = messages[messages.length - 1];
  const hours = (new Date() - new Date(last.timestamp)) / 36e5;
  return hours > 5;
}
function getConversationHistoryForAI(username, phone, n = 10) {
  const msgs = getClientMessagesForUser(username, phone).slice(-n);
  return msgs.map(m => ({ role: m.fromMe ? 'assistant' : 'user', content: m.message }));
}

// =======================================================
// DeepSeek + Fallback sales replies (Arabic)
// =======================================================
async function callDeepSeekAI(userMessage, clientPhone) {
  if (!deepseekAvailable) throw new Error('DeepSeek not available');
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: AI_SYSTEM_PROMPT }, { role: "user", content: userMessage }],
      max_tokens: 500, temperature: 0.7
    })
  });
  if (!response.ok) throw new Error('DeepSeek HTTP ' + response.status);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '...';
}

// ——— keyword-based Arabic responses (kept from your original logic) ———
function generateEnhancedRagmcloudResponse(userMessage, clientPhone) {
  const msg = (userMessage || '').toLowerCase().trim();
  const greet = `السلام عليكم ورحمة الله وبركاته 🌟

أهلاً وسهلاً بك! أنا مساعدك في نظام رقم كلاود ERP.
أنا هنا لمساعدتك في:
• اختيار الباقة المناسبة لشركتك
• شرح ميزات نظام ERP السحابي
• الإجابة على استفساراتك التقنية والمحاسبية

📞 للاستشارة المجانية: +966555111222
🌐 الموقع: ragmcloud.sa

كيف يمكنني مساعدتك اليوم؟`;

  if (['السلام','سلام','اهلا','مرحبا','اهلين','مساء','صباح','hello','hi'].some(k=>msg.includes(k))) {
    return greet;
  }

  if (['سعر','تكلفة','باقة','package','price','كم','تعرفة'].some(k=>msg.includes(k))) {
    return `✅ **باقات رقم كلاود السنوية:**

🏷️ **الأساسية** — 1000 ريال/سنوياً  
• مستخدم واحد • فرع واحد • 500 فاتورة/شهر

🏷️ **المتقدمة** — 1800 ريال/سنوياً  
• مستخدمين • فرعين • 1000 فاتورة/شهر

🏷️ **الاحترافية** — 2700 ريال/سنوياً  
• 3 مستخدمين • 3 فروع • 2000 فاتورة/شهر

🏷️ **المميزة** — 3000 ريال/سنوياً  
• 3 مستخدمين • 3 فروع • فواتير غير محدودة

💡 ما يناسبك يعتمد على: عدد المستخدمين، عدد الفروع، وطبيعة نشاط شركتك.
📞 فريق المبيعات: +966555111222`;
  }

  if (['نظام','erp','برنامج','سوفت','system'].some(k=>msg.includes(k))) {
    return `🌟 **نظام رقم كلاود ERP السحابي**

✅ المزايا:  
• محاسبة متكاملة (متوافق مع الزكاة والضريبة)  
• مخزون ومستودعات ذكية  
• موارد بشرية ورواتب  
• CRM وإدارة العملاء  
• تقارير فورية وتحليلات ذكية  
• تكامل مع المنصات الحكومية

🚀 الفوائد: توفير الوقت، تقليل الأخطاء، متابعة الفروع من مكان واحد.  
📞 جرّبه مجاناً: +966555111222`;
  }

  if (['محاسبة','محاسب','حسابات','مالي','accounting'].some(k=>msg.includes(k))) {
    return `🧮 **الحلول المحاسبية في رقم كلاود**
• الدفاتر والتقارير المالية المتوافقة مع الزكاة والضريبة  
• تسجيل الفواتير والمصروفات والقيود  
• كشوف الحساب والتسويات البنكية  
• واجهة عربية سهلة + نسخ احتياطي

📞 استشارة محاسبية مجانية: +966555111222`;
  }

  if (['مخزون','مستودع','بضاعة','inventory','stock'].some(k=>msg.includes(k))) {
    return `📦 **إدارة المخزون**
• تتبع دقيق للمنتجات والفروع والمستودعات  
• تنبيهات نقص المخزون وجرد ذكي  
• تقارير ربحية وتحليل الحركة

📞 لمزيد من التفاصيل: +966555111222`;
  }

  if (['تجربة','تجريب','demo','جرب','نسخة'].some(k=>msg.includes(k))) {
    return `⏱️ **جرّب نظام رقم كلاود مجاناً 7 أيام**

تحصل على:  
• وصول كامل للميزات  
• دعم خلال التجربة  
• تدريب مبسّط على الاستخدام

**طريقة البدء:**  
1) تواصل مع فريق المبيعات  
2) حدّد موعد للتدريب  
3) ابدأ فوراً

📞 966555111222+  |  🌐 ragmcloud.sa`;
  }

  if (['اتصل','تواصل','رقم','هاتف','contact'].some(k=>msg.includes(k))) {
    return `📞 **التواصل مع رقم كلاود**
الهاتف/واتساب: +966555111222  
البريد: info@ragmcloud.sa  
الموقع: ragmcloud.sa  
الأوقات: الأحد–الخميس | 8ص–6م`;
  }

  return `أهلاً بك 👋  
أنا مساعد رقم كلاود ERP.  
أقدر أساعدك تختار الباقة المناسبة، أشرح الميزات، أو أرتّب لك تجربة مجانية.  
قل لي عن نشاط شركتك وعدد المستخدمين والفروع لتجهيز العرض المناسب.`;
}

// =======================================================
// Auto status/interest & timers (kept behavior, per-user)
// =======================================================
const replyTimerByUser = new Map(); // username -> Map(phone->timestamp)

function shouldAutoReplyNow(username, phone) {
  if (!replyTimerByUser.has(username)) replyTimerByUser.set(username, new Map());
  const m = replyTimerByUser.get(username);
  const last = m.get(phone);
  if (!last) return true;
  return (Date.now() - last) >= 3000; // 3s
}
function updateReplyTimer(username, phone) {
  replyTimerByUser.get(username).set(phone, Date.now());
}
function autoDetectClientInterest(username, phone, message) {
  try {
    const msg = (message || '').toLowerCase();
    const interested = ['سعر','تكلفة','عرض','خصم','تجربة','مميزات','تفاصيل','أريد','اتصال','تواصل'];
    const busy = ['لاحقاً','مشغول','بعدين','الوقت'];
    const notInterested = ['لا أريد','غير مهتم','شكراً','توقف','لا تتصل','بلوك'];
    let status = 'no-reply';
    if (interested.some(k=>msg.includes(k))) status='interested';
    else if (busy.some(k=>msg.includes(k))) status='busy';
    else if (notInterested.some(k=>msg.includes(k))) status='not-interested';

    // write to clients.json for this user if found
    const cf = path.join(__dirname, 'memory', username, 'clients.json');
    if (fs.existsSync(cf)) {
      const clients = JSON.parse(fs.readFileSync(cf,'utf8'));
      const i = clients.findIndex(c=>c.phone===phone);
      if (i !== -1) {
        clients[i].status = status;
        clients[i].statusUpdatedAt = new Date().toISOString();
        fs.writeFileSync(cf, JSON.stringify(clients,null,2));
        io.emit(`client_status_updated_${username}`, { phone, status, clients });
      }
    }
    if (status==='interested') trackEmployeeActivity(username,'client_interested',{clientPhone:phone});
  } catch {}
}

// =======================================================
// Message processing (AI first, fallback to Arabic templates)
// =======================================================
async function processIncomingMessageForUser(username, body, fromJid) {
  const phone = fromJid.replace('@c.us','');
  storeClientMessageForUser(username, phone, body, false);
  autoDetectClientInterest(username, phone, body);

  // do we reply?
  if (!shouldAutoReplyNow(username, phone)) return;

  let reply;
  try {
    if (deepseekAvailable) {
      const history = getConversationHistoryForAI(username, phone, 10);
      const sys = AI_SYSTEM_PROMPT;
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_KEY}`},
        body: JSON.stringify({ model:'deepseek-chat', messages:[{role:'system',content:sys}, ...history, {role:'user',content:body}], temperature:0.7, max_tokens:500 })
      });
      if (!response.ok) throw new Error('DeepSeek HTTP '+response.status);
      const data = await response.json();
      reply = data?.choices?.[0]?.message?.content?.trim();
    }
    if (!reply) reply = generateEnhancedRagmcloudResponse(body, phone);
  } catch (e) {
    console.error('DeepSeek error, using fallback:', e.message);
    reply = generateEnhancedRagmcloudResponse(body, phone);
  }

  const client = clientsByUser.get(username);
  if (!client) return;
  await client.sendMessage(fromJid, reply);

  storeClientMessageForUser(username, phone, reply, true);
  updateReplyTimer(username, phone);
  trackEmployeeActivity(username,'ai_reply',{clientPhone:phone});

  io.emit(`message_${username}`, { from: phone, message: reply, user: username, timestamp: new Date(), fromMe: true });
  updateClientLastMessageForUser(username, phone, reply);
}

// =======================================================
// Per-user WhatsApp initialization
// =======================================================
function initializeWhatsAppForUser(username) {
  console.log('🔄 Initialize WhatsApp for', username);

  // if exists, destroy previous
  if (clientsByUser.get(username)) {
    try { clientsByUser.get(username).destroy(); } catch {}
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: username, dataPath: './sessions' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--no-first-run','--no-zygote','--disable-gpu']
    }
  });

  // events
  client.on('qr', (qr) => {
    console.log(`📱 QR received for ${username}`);
    qrcodeTerminal.generate(qr, { small:true });
    QRCode.toDataURL(qr, (err, url) => {
      if (!err) {
        qrByUser.set(username, url);
        isConnectedByUser.set(username, false);
        io.emit(`qr_${username}`, { qr: url, user: username });
        io.emit(`status_${username}`, { connected: false, message: 'يرجى مسح QR Code للاتصال', user: username });
      }
    });
  });

  client.on('ready', () => {
    console.log(`✅ WhatsApp ready for ${username}`);
    isConnectedByUser.set(username, true);
    qrByUser.set(username, '');
    io.emit(`status_${username}`, { connected: true, message: 'واتساب متصل ✅', user: username });
    io.emit(`qr_${username}`, { qr: '', user: username });
  });

  client.on('disconnected', (reason) => {
    console.log(`❌ Disconnected for ${username}:`, reason);
    isConnectedByUser.set(username, false);
    io.emit(`status_${username}`, { connected: false, message: 'انقطع الاتصال ⚠️', user: username });
    setTimeout(() => initializeWhatsAppForUser(username), 5000);
  });

  client.on('message', async (message) => {
    if (message.from === 'status@broadcast' || message.fromMe) return;
    const phone = message.from.replace('@c.us','');
    storeClientMessageForUser(username, phone, message.body, false);
    io.emit(`message_${username}`, { from: phone, message: message.body, user: username, timestamp: new Date(), fromMe: false });
    updateClientLastMessageForUser(username, phone, message.body);
    // async AI reply
    processIncomingMessageForUser(username, message.body, message.from).catch(e=>console.error('processIncomingMessage error:', e));
  });

  client.initialize().catch(err => {
    console.error(`init error (${username}):`, err);
    setTimeout(()=>initializeWhatsAppForUser(username), 10000);
  });

  clientsByUser.set(username, client);
  if (!replyTimerByUser.has(username)) replyTimerByUser.set(username, new Map());
  ensurePerf(username);
}

// =======================================================
// Excel processing (per user)
// =======================================================
function formatPhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = phone.toString().replace(/\D/g,'');
  if (cleaned.startsWith('0')) cleaned = '966' + cleaned.slice(1);
  else if (cleaned.startsWith('+966')) cleaned = cleaned.slice(1);
  else if (cleaned.length === 9) cleaned = '966' + cleaned;
  return cleaned;
}
function processExcelFile(filePath, username) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws);
  const clients = data.map((row, i) => {
    const name = row['Name'] || row['name'] || row['الاسم'] || row['اسم'] || `عميل ${i+1}`;
    const phone = formatPhoneNumber(row['Phone'] || row['phone'] || row['الهاتف'] || row['جوال'] || row['رقم الهاتف']);
    return { id: i+1, name, phone, lastMessage: 'لم يتم المراسلة بعد', unread: 0, importedAt: new Date().toISOString(), lastActivity: new Date().toISOString(), status:'no-reply' };
  }).filter(c=>c.phone && c.phone.length>=10);

  const memDir = path.join(__dirname,'memory',username);
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir,{recursive:true});
  fs.writeFileSync(path.join(memDir,'clients.json'), JSON.stringify(clients,null,2));
  return clients;
}

// =======================================================
// API — per user endpoints
// =======================================================

// upload excel
app.post('/api/:username/upload-excel', verifyToken, (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.username !== req.params.username)
    return res.status(403).json({ error: 'Forbidden' });
  next();
}, upload.single('excelFile'), (req,res)=>{
  try {
    const username = req.params.username;
    if (!req.file) return res.status(400).json({ error:'لم يتم رفع أي ملف' });
    const clients = processExcelFile(req.file.path, username);
    fs.unlinkSync(req.file.path);
    io.emit(`clients_updated_${username}`, clients);
    res.json({ success:true, clients, count: clients.length });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'فشل معالجة الملف: '+e.message });
  }
});

// list clients
app.get('/api/:username/clients', verifyToken, (req,res)=>{
  const username = req.params.username;
  if (req.user.role !== 'admin' && req.user.username !== username)
    return res.status(403).json({ error:'Forbidden' });
  const file = path.join(__dirname,'memory',username,'clients.json');
  const clients = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
  res.json({ success:true, clients });
});

// client messages
app.get('/api/:username/client-messages/:phone', verifyToken, (req,res)=>{
  const { username, phone } = req.params;
  if (req.user.role !== 'admin' && req.user.username !== username)
    return res.status(403).json({ error:'Forbidden' });
  res.json({ success:true, messages: getClientMessagesForUser(username, phone) });
});

// toggle bot
app.post('/api/:username/toggle-bot', verifyToken, (req,res)=>{
  const username = req.params.username;
  if (req.user.role !== 'admin' && req.user.username !== username)
    return res.status(403).json({ error:'Forbidden' });
  const stop = !!req.body.stop;
  botStoppedByUser.set(username, stop);
  io.emit(`bot_status_${username}`, { stopped: stop });
  res.json({ success:true, stopped: stop });
});

// send single message
app.post('/api/:username/send-message', verifyToken, async (req,res)=>{
  const username = req.params.username;
  if (req.user.role !== 'admin' && req.user.username !== username)
    return res.status(403).json({ error:'Forbidden' });

  const { phone, message } = req.body || {};
  if (!phone || !message) return res.status(400).json({ error:'رقم الهاتف والرسالة مطلوبة' });
  const client = clientsByUser.get(username);
  if (!client) return res.status(400).json({ error:'واتساب غير متصل' });

  const formatted = formatPhoneNumber(phone) + '@c.us';
  try {
    await client.sendMessage(formatted, message);
    trackEmployeeActivity(username,'message_sent',{clientPhone:formatPhoneNumber(phone), message: message.slice(0,30)});
    storeClientMessageForUser(username, phone, message, true);
    updateClientLastMessageForUser(username, phone, message);
    res.json({ success:true, message:'تم إرسال الرسالة بنجاح' });
  } catch (e) {
    res.status(500).json({ error: 'فشل إرسال الرسالة: '+e.message });
  }
});

// bulk send
app.post('/api/:username/send-bulk', verifyToken, async (req,res)=>{
  const username = req.params.username;
  if (req.user.role !== 'admin' && req.user.username !== username)
    return res.status(403).json({ error:'Forbidden' });

  const { message, delay = 40, clients } = req.body || {};
  const client = clientsByUser.get(username);
  if (!client) return res.status(400).json({ error:'واتساب غير متصل' });
  if (!message || !clients || !clients.length) return res.status(400).json({ error:'الرسالة وقائمة العملاء مطلوبة' });

  trackEmployeeActivity(username, 'bulk_campaign', { clientCount: clients.length, message: message.slice(0,50) });
  io.emit(`bulk_progress_${username}`, { type:'start', total: clients.length });

  let ok=0, fail=0;
  for (let i=0;i<clients.length;i++){
    const c = clients[i];
    const formatted = (c.phone && formatPhoneNumber(c.phone)) ? formatPhoneNumber(c.phone)+'@c.us' : null;
    if (!formatted) { fail++; continue; }
    try {
      if (i>0) await new Promise(r=>setTimeout(r, delay*1000));
      await client.sendMessage(formatted, message);
      ok++;
      storeClientMessageForUser(username, c.phone, message, true);
      io.emit(`bulk_progress_${username}`, { success:true, client:c.name, clientPhone:c.phone, current:i+1, total:clients.length });
    } catch (e) {
      fail++;
      io.emit(`bulk_progress_${username}`, { success:false, client:c.name, clientPhone:c.phone, error:e.message, current:i+1, total:clients.length });
    }
  }
  res.json({ success:true, message:`تم إرسال ${ok} وفشل ${fail}` });
});

// reports
function generateEmployeePerformanceReport(username) {
  const p = ensurePerf(username).dailyStats;
  const interestRate = p.clientsContacted>0 ? (p.interestedClients/p.clientsContacted*100).toFixed(1) : 0;
  let score = Math.min(p.messagesSent*2,30)+Math.min(p.clientsContacted*5,30)+Math.min(p.interestedClients*10,40);
  const level = score>=80?'ممتاز':score>=60?'جيد جداً':score>=40?'جيد':score>=20?'مقبول':'ضعيف';
  return `
📊 **تقرير أداء الموظف - ${username} - ${p.date}**

• الرسائل: ${p.messagesSent}
• العملاء المتواصل معهم: ${p.clientsContacted}
• ردود الذكاء الاصطناعي: ${p.aiRepliesSent}
• الحملات الجماعية: ${p.bulkCampaigns}
• العملاء المهتمون: ${p.interestedClients}
• معدل الاهتمام: ${interestRate}%
• المستوى: ${level} (النقاط: ${score}/100)
`.trim();
}

app.get('/api/:username/export-report', verifyToken, (req,res)=>{
  const username = req.params.username;
  if (req.user.role !== 'admin' && req.user.username !== username)
    return res.status(403).json({ error:'Forbidden' });
  const report = generateEmployeePerformanceReport(username);
  const dir = path.join(__dirname,'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const file = path.join(dir, `employee_report_${username}_${Date.now()}.txt`);
  fs.writeFileSync(file, report, 'utf8');
  res.download(file, path.basename(file));
});

app.post('/api/:username/send-to-manager', verifyToken, async (req,res)=>{
  const username = req.params.username;
  if (req.user.role !== 'admin' && req.user.username !== username)
    return res.status(403).json({ error:'Forbidden' });
  const client = clientsByUser.get(username);
  if (!client) return res.status(400).json({ error:'واتساب غير متصل' });
  const report = generateEmployeePerformanceReport(username);
  try {
    await client.sendMessage('966531304279@c.us', report);
    res.json({ success:true, message:'تم إرسال التقرير إلى المدير' });
  } catch (e) {
    res.status(500).json({ error:'فشل إرسال التقرير: '+e.message });
  }
});

// qr status
app.get('/api/:username/qr-status', (req,res)=>{
  const u = req.params.username;
  res.json({ connected: !!isConnectedByUser.get(u), qrAvailable: !!qrByUser.get(u) && !isConnectedByUser.get(u), qrCode: qrByUser.get(u) || '' });
});

// reconnect
app.post('/api/:username/reconnect', verifyToken, (req,res)=>{
  const u = req.params.username;
  if (req.user.role !== 'admin' && req.user.username !== u)
    return res.status(403).json({ error:'Forbidden' });
  initializeWhatsAppForUser(u);
  res.json({ success:true, message:'جارٍ إعادة الاتصال...' });
});

// =======================================================
// Socket.io
// =======================================================
io.on('connection', (socket)=>{
  console.log('🖥️ Frontend connected');

  socket.on('join', ({username})=>{
    socket.join('user:'+username);
    // send current status/qr
    const st = !!isConnectedByUser.get(username);
    const qr = qrByUser.get(username) || '';
    socket.emit(`status_${username}`, { connected: st, message: st ? 'واتساب متصل ✅' : 'جارٍ الاتصال...', user: username });
    if (!st && qr) socket.emit(`qr_${username}`, { qr, user: username });
  });

  socket.on('start_whatsapp', ({username})=>{
    initializeWhatsAppForUser(username);
  });

  socket.on('toggle_bot', ({username, stop})=>{
    botStoppedByUser.set(username, !!stop);
    io.emit(`bot_status_${username}`, { stopped: !!stop });
  });

  socket.on('disconnect', ()=> console.log('🔴 Frontend disconnected'));
});

// =======================================================
// Start
// =======================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>{
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('🏢 Company:', ragmcloudCompanyInfo.name);
  console.log('🤖 DeepSeek:', deepseekAvailable ? 'Enabled' : 'Disabled');
  console.log('👑 Admin login: IT / @Admin4004');
  console.log('📂 Per-user sessions: ./sessions (clientId=username)');
});
