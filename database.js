// database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'erp_bot.db');
const db = new sqlite3.Database(dbPath);

// Initialize database
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        is_active INTEGER DEFAULT 1
    )`);

    // Conversations table
    db.run(`CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        client_phone TEXT NOT NULL,
        message_text TEXT NOT NULL,
        message_type TEXT NOT NULL, -- 'sent' or 'received'
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Clients table
    db.run(`CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        name TEXT,
        status TEXT DEFAULT 'new',
        last_message TEXT,
        last_activity DATETIME,
        assigned_user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (assigned_user_id) REFERENCES users (id)
    )`);

    // Employee Performance table
    db.run(`CREATE TABLE IF NOT EXISTS employee_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        date TEXT NOT NULL,
        messages_sent INTEGER DEFAULT 0,
        clients_contacted INTEGER DEFAULT 0,
        ai_replies_sent INTEGER DEFAULT 0,
        bulk_campaigns INTEGER DEFAULT 0,
        interested_clients INTEGER DEFAULT 0,
        start_time DATETIME,
        last_activity DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Insert default admin user
    const adminPassword = bcrypt.hashSync('@Admin4040', 10);
    db.run(`INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`, 
        ['IT', adminPassword, 'admin']);
});

// Database helper functions
const dbHelper = {
    // User management
    getUserByUsername: (username) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    createUser: (username, password, role = 'user') => {
        return new Promise((resolve, reject) => {
            const hashedPassword = bcrypt.hashSync(password, 10);
            db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', 
                [username, hashedPassword, role], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
    },

    updateUserLastLogin: (userId) => {
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
    },

    getAllUsers: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT id, username, role, created_at, last_login, is_active FROM users', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // Conversation management
    saveConversation: (userId, clientPhone, message, messageType) => {
        return new Promise((resolve, reject) => {
            db.run(`INSERT INTO conversations (user_id, client_phone, message_text, message_type) 
                    VALUES (?, ?, ?, ?)`, 
                [userId, clientPhone, message, messageType], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
    },

    getConversationsByUser: (userId, clientPhone = null) => {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM conversations WHERE user_id = ?`;
            let params = [userId];
            
            if (clientPhone) {
                query += ` AND client_phone = ?`;
                params.push(clientPhone);
            }
            
            query += ` ORDER BY timestamp DESC LIMIT 50`;
            
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // Client management
    saveOrUpdateClient: (phone, name, assignedUserId = null) => {
        return new Promise((resolve, reject) => {
            db.run(`INSERT OR REPLACE INTO clients (phone, name, assigned_user_id, last_activity) 
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, 
                [phone, name, assignedUserId], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
    },

    getClientsByUser: (userId) => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT c.*, COUNT(conv.id) as message_count 
                    FROM clients c 
                    LEFT JOIN conversations conv ON c.phone = conv.client_phone AND conv.user_id = ?
                    WHERE c.assigned_user_id = ?
                    GROUP BY c.phone
                    ORDER BY c.last_activity DESC`, 
                [userId, userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    getAllClients: () => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT c.*, u.username as assigned_user, COUNT(conv.id) as message_count 
                    FROM clients c 
                    LEFT JOIN users u ON c.assigned_user_id = u.id
                    LEFT JOIN conversations conv ON c.phone = conv.client_phone
                    GROUP BY c.phone
                    ORDER BY c.last_activity DESC`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // Performance tracking
    updateEmployeePerformance: (userId, date, field, increment = 1) => {
        return new Promise((resolve, reject) => {
            // First, ensure record exists
            db.run(`INSERT OR IGNORE INTO employee_performance (user_id, date, start_time) 
                    VALUES (?, ?, CURRENT_TIMESTAMP)`, [userId, date]);
            
            // Then update the field
            db.run(`UPDATE employee_performance SET ${field} = ${field} + ?, last_activity = CURRENT_TIMESTAMP 
                    WHERE user_id = ? AND date = ?`, 
                [increment, userId, date], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    getPerformanceByUser: (userId, date) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM employee_performance WHERE user_id = ? AND date = ?`, 
                [userId, date], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    getAllPerformance: (date) => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT ep.*, u.username 
                    FROM employee_performance ep 
                    JOIN users u ON ep.user_id = u.id 
                    WHERE ep.date = ?`, 
                [date], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};

module.exports = { db, dbHelper };
