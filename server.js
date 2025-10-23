// ======================================================
// ===== PART 1 — Imports, Config, and Authentication ===
// ======================================================

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

// Initialize Express & Server
const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// JSON parsing & static directory
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Ensure directories exist
['uploads', 'memory', 'tmp', 'reports', 'sessions', 'public'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ===========================================
// DATABASE SETUP (SQLite)
// ===========================================
const dbPath = path.join(__dirname, 'users.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT
    )
  `);

  // Create default admin if not exists
  db.get(`SELECT * FROM users WHERE username = ?`, ['IT'], (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync('@Admin4004', 10);
      db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
        ['IT', hash, 'admin']);
      console.log('✅ Default admin created (username: IT / pass: @Admin4004)');
    }
  });
});

// ===========================================
// AUTHENTICATION SYSTEM (JWT + ROLES)
// ===========================================

// Middleware: verify JWT token
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized: no token' });

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET || 'ragmcloud_secret_2025', (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  });
}

// Middleware: only allow admins
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

// Login route
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { username: user.username, role: user.role },
      process.env.JWT_SECRET || 'ragmcloud_secret_2025',
      { expiresIn: '7d' }
    );

    // Redirect user by role
    let redirectPage =
      user.role === 'admin'
        ? '/admin.html'
        : `/dashboard_${user.username}.html`;

    res.json({
      success: true,
      token,
      role: user.role,
      redirect: redirectPage
    });
  });
});

// Admin: create new users
app.post('/api/users', verifyToken, requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role)
    return res.status(400).json({ error: 'Missing fields' });

  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
    [username, hash, role],
    err => {
      if (err) return res.status(400).json({ error: 'User already exists' });
      res.json({ success: true, message: 'User created successfully' });
    }
  );
});

// Admin: list users
app.get('/api/users', verifyToken, requireAdmin, (req, res) => {
  db.all(`SELECT id, username, role FROM users`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ users: rows });
  });
});

// Serve dashboard files dynamically
app.get('/dashboard/:username', verifyToken, (req, res) => {
  const filePath = path.join(__dirname, 'public', `dashboard_${req.params.username}.html`);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Dashboard not found');
  }
});

// ===========================================
// MULTER SETUP FOR FILE UPLOADS
// ===========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
// ======================================================
// ===== PART 2 — WhatsApp Logic & DeepSeek AI ==========
// ======================================================

// WhatsApp state variables
let whatsappClient;
let isConnected = false;
let qrCodeUrl = '';
let isBotStopped = false;

// Store DeepSeek API key from .env
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
let deepseekAvailable = !!DEEPSEEK_KEY;
console.log(deepseekAvailable ? '✅ DeepSeek API key loaded' : '❌ DeepSeek key missing');

// ===========================================
// COMPANY INFO & AI PROMPT
// ===========================================
const ragmcloudCompanyInfo = {
  name: "رقم كلاود",
  englishName: "Ragmcloud ERP",
  website: "https://ragmcloud.sa",
  phone: "+966555111222",
  email: "info@ragmcloud.sa",
  address: "الرياض - حي المغرزات - طريق الملك عبد الله",
  workingHours: "من الأحد إلى الخميس - 8 صباحاً إلى 6 مساءً"
};

const AI_SYSTEM_PROMPT = `أنت مساعد ذكي يمثل شركة رقم كلاود ERP... (same as your original long prompt here)`;

// ===========================================
// MESSAGE MEMORY & UTILITIES
// ===========================================
function storeClientMessage(username, phone, message, fromMe) {
  try {
    const folder = path.join(__dirname, 'memory', username);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, `messages_${phone}.json`);

    const msg = { message, fromMe, timestamp: new Date().toISOString() };
    let msgs = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath))
      : [];
    msgs.push(msg);
    if (msgs.length > 50) msgs = msgs.slice(-50);
    fs.writeFileSync(filePath, JSON.stringify(msgs, null, 2));
  } catch (err) {
    console.error('Error storing message:', err);
  }
}

function getClientMessages(username, phone) {
  try {
    const filePath = path.join(__dirname, 'memory', username, `messages_${phone}.json`);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath));
  } catch {
    return [];
  }
}

// ===========================================
// DEEPSEEK AI RESPONSE HANDLER
// ===========================================
async function callDeepSeekAI(userMessage, clientPhone) {
  if (!deepseekAvailable) throw new Error('DeepSeek key not found');
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_KEY}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
      max_tokens: 500,
      temperature: 0.7
    })
  });

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "لم أتمكن من الرد حالياً.";
}

// ===========================================
// WHATSAPP INITIALIZATION (PER USER)
// ===========================================
function initializeWhatsAppForUser(username) {
  console.log(`🔄 Starting WhatsApp for user: ${username}`);

  const sessionDir = path.join(__dirname, 'sessions', username);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: username,
      dataPath: sessionDir
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  });

  // ========== EVENTS ==========
  client.on('qr', async (qr) => {
    console.log(`📱 QR for ${username}`);
    qrcodeTerminal.generate(qr, { small: true });
    QRCode.toDataURL(qr, (err, url) => {
      if (!err) {
        qrCodeUrl = url;
        io.emit(`qr_${username}`, { qr: url, user: username });
      }
    });
  });

  client.on('ready', () => {
    console.log(`✅ WhatsApp READY for ${username}`);
    isConnected = true;
    io.emit(`status_${username}`, { connected: true, message: 'واتساب متصل ✅', user: username });
  });

  client.on('disconnected', (reason) => {
    console.log(`⚠️ ${username} disconnected:`, reason);
    isConnected = false;
    io.emit(`status_${username}`, { connected: false, message: 'انقطع الاتصال ⚠️', user: username });
    setTimeout(() => initializeWhatsAppForUser(username), 5000);
  });

  client.on('message', async (message) => {
    if (message.from === 'status@broadcast' || message.fromMe) return;
    const phone = message.from.replace('@c.us', '');
    storeClientMessage(username, phone, message.body, false);
    io.emit(`message_${username}`, {
      from: phone,
      message: message.body,
      user: username,
      timestamp: new Date(),
      fromMe: false
    });
    if (!isBotStopped) {
      try {
        const aiReply = await callDeepSeekAI(message.body, phone);
        await client.sendMessage(message.from, aiReply);
        storeClientMessage(username, phone, aiReply, true);
        io.emit(`message_${username}`, {
          from: phone,
          message: aiReply,
          user: username,
          timestamp: new Date(),
          fromMe: true
        });
      } catch (err) {
        console.error('AI Reply Error:', err);
      }
    }
  });

  client.initialize().catch(err => {
    console.error(`❌ WhatsApp init failed for ${username}:`, err);
  });

  return client;
}
// ======================================================
// ===== PART 3 — Socket.io, QR Reflection & Reports ====
// ======================================================

// ========== SOCKET.IO HANDLERS ==========
io.on('connection', (socket) => {
  console.log('🟢 Frontend connected');

  // When frontend requests to start WhatsApp for this user
  socket.on('start_whatsapp', (data) => {
    const username = data.username;
    console.log(`⚙️ Initializing WhatsApp for user: ${username}`);
    initializeWhatsAppForUser(username);
  });

  // Listen for manual reconnect
  socket.on('reconnect_user', (data) => {
    const username = data.username;
    console.log(`🔄 Manual reconnect for ${username}`);
    initializeWhatsAppForUser(username);
  });

  // Toggle bot status (start / stop auto replies)
  socket.on('toggle_bot', (data) => {
    isBotStopped = data.stop;
    io.emit('bot_status', { stopped: isBotStopped });
    console.log(`🤖 Bot ${isBotStopped ? 'stopped' : 'running'}`);
  });

  socket.on('disconnect', () => {
    console.log('🔴 Frontend disconnected');
  });
});

// ======================================================
// ===== ROUTES FOR FRONTEND STATUS & QR UPDATES ========
// ======================================================

// Get connection status (used for polling)
app.get('/api/qr-status/:username', (req, res) => {
  res.json({
    connected: isConnected,
    qrAvailable: !!qrCodeUrl && !isConnected,
    qrCode: qrCodeUrl,
    user: req.params.username
  });
});

// ======================================================
// ===== PERFORMANCE & REPORTING PLACEHOLDERS ===========
// ======================================================

// You can later connect this to your employee stats
app.get('/api/report/:username', verifyToken, (req, res) => {
  const username = req.params.username;
  const reportPath = path.join(__dirname, 'reports', `${username}_report.txt`);
  if (fs.existsSync(reportPath)) {
    res.download(reportPath);
  } else {
    res.status(404).json({ error: 'No report found' });
  }
});

// ======================================================
// ===== STATIC ROUTES FOR LOGIN & ADMIN DASHBOARD ======
// ======================================================

// Serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Admin page
app.get('/admin', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('Admins only');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ======================================================
// ===== SERVER START ===================================
// ======================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('🚀 Server running at: http://localhost:' + PORT);
  console.log('🏢 Company:', ragmcloudCompanyInfo.name);
  console.log('🔐 JWT Secret:', process.env.JWT_SECRET ? 'Loaded' : 'Default used');
  console.log('🤖 DeepSeek:', deepseekAvailable ? 'Enabled' : 'Disabled');
  console.log('📱 Multi-session WhatsApp ready (per user folder).');
  console.log('👑 Default admin → user: IT | pass: @Admin4004');
  console.log('✅ System initialized successfully.');
});
