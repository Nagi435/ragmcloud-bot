// ===============================
// Ragmcloud WhatsApp AI Bot Server
// ===============================

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const XLSX = require('xlsx');

// --- App & Server setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Serve Frontend ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Directories setup ---
const directories = ['uploads', 'memory', 'tmp', 'reports', 'sessions'];
directories.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// --- WhatsApp Client ---
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './sessions' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// --- Socket.io Events ---
console.log('QR Code generated')

client.on('ready', () => {
  console.log('✅ WhatsApp is ready');
  io.emit('status', 'connected');
});

client.on('disconnected', () => {
  console.log('❌ WhatsApp disconnected');
  io.emit('status', 'disconnected');
  client.initialize();
});

client.initialize();

// --- Example Route ---
app.get('/health', (req, res) => {
  res.send('Ragmcloud Bot is running ✅');
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server is live on port ${PORT}`);
});
