// ===============================
//  WhatsApp Bot Server (Fixed QR)
// ===============================

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// --- Initialize Express App ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }
});

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Serve Static Files (for your public folder) ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Ensure required directories exist ---
const directories = ['uploads', 'reports', 'sessions'];
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
});

// --- Multer for Excel Upload ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// --- WhatsApp Client Setup ---
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './sessions'
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// ===============================
//  WhatsApp Events
// ===============================

// ✅ Generate QR and send as Base64 image
client.on('qr', async (qr) => {
  console.log('QR Code generated');
  try {
    const qrImage = await QRCode.toDataURL(qr);
    io.emit('qr', { qr: qrImage });
  } catch (err) {
    console.error('QR conversion error:', err);
    io.emit('qr_error', 'Failed to generate QR image');
  }
});

// ✅ WhatsApp ready
client.on('ready', () => {
  console.log('✅ WhatsApp is ready!');
  io.emit('status', { connected: true, message: 'متصل ✅' });
});

// ✅ Disconnected or logout
client.on('disconnected', (reason) => {
  console.log('❌ WhatsApp disconnected:', reason);
  io.emit('status', { connected: false, message: 'غير متصل ❌' });
});

// ✅ Handle received messages
client.on('message', (msg) => {
  console.log(`📩 Message from ${msg.from}: ${msg.body}`);
  io.emit('message', {
    from: msg.from,
    message: msg.body,
    timestamp: new Date().toISOString(),
    fromMe: msg.fromMe || false
  });
});

// ✅ Handle send message from frontend
io.on('connection', (socket) => {
  console.log('⚡ New socket connected');

  socket.on('send_message', async (data) => {
    try {
      const { to, message } = data;
      await client.sendMessage(to, message);
      io.emit('message_sent', { to, message });
    } catch (err) {
      console.error('❌ Send message error:', err);
      io.emit('message_error', { to: data.to, error: err.message });
    }
  });

  socket.on('reconnect_whatsapp', async () => {
    console.log('♻️ Manual reconnect requested');
    try {
      await client.initialize();
      io.emit('status', { connected: true, message: 'تم إعادة الاتصال ✅' });
    } catch (err) {
      console.error('❌ Reconnect failed:', err);
      io.emit('status', { connected: false, message: 'فشل إعادة الاتصال ❌' });
    }
  });
});

// ===============================
//  REST API Endpoints
// ===============================

// Upload Excel contacts
app.post('/api/upload-excel', upload.single('excelFile'), (req, res) => {
  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    const clients = data.map(row => ({
      name: row.Name || 'بدون اسم',
      phone: row.Phone?.toString().trim(),
      status: 'no-reply'
    }));
    res.json({ success: true, clients, count: clients.length });
  } catch (err) {
    console.error('Excel upload error:', err);
    res.status(500).json({ success: false, error: 'فشل قراءة ملف Excel' });
  }
});

// Send bulk message (simulation)
app.post('/api/send-bulk', async (req, res) => {
  const { message, clients, delay } = req.body;
  if (!message || !clients || clients.length === 0) {
    return res.status(400).json({ success: false, error: 'البيانات غير صحيحة' });
  }

  console.log(`🚀 Starting bulk send to ${clients.length} clients...`);
  for (const clientData of clients) {
    await new Promise(resolve => setTimeout(resolve, delay * 1000));
    console.log(`Sent to: ${clientData.phone}`);
    io.emit('bulk_progress', { client: clientData.phone, success: true });
  }

  res.json({ success: true, message: 'تم إرسال جميع الرسائل بنجاح ✅' });
});

// Default route for frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===============================
//  Start Server
// ===============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server is live on port ${PORT}`);
});

// Initialize WhatsApp client
client.initialize();

