const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

class Database {
    constructor() {
        // Ensure database file exists
        const dbPath = './database.sqlite';
        
        // Create file if it doesn't exist (for Render compatibility)
        if (!fs.existsSync(dbPath)) {
            fs.writeFileSync(dbPath, '');
            console.log('✅ Created new database file');
        }

        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ Error opening database:', err.message);
            } else {
                console.log('✅ Connected to SQLite database');
                this.initDatabase();
            }
        });
    }

    // ... (ALL YOUR DATABASE METHODS REMAIN THE SAME) ...
    // Make sure to include ALL the methods from the previous database.js file

    // Initialize database tables
    initDatabase() {
        // Users table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        `);

        // Conversations table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                client_phone TEXT NOT NULL,
                message_text TEXT NOT NULL,
                is_from_me BOOLEAN DEFAULT 0,
                message_type TEXT DEFAULT 'text',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `);

        // Client status table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS client_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_phone TEXT UNIQUE NOT NULL,
                status TEXT DEFAULT 'no-reply',
                last_contact DATETIME DEFAULT CURRENT_TIMESTAMP,
                user_id INTEGER,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `);

        // Initialize admin user
        this.initAdminUser();
    }

    // Create default admin user
    async initAdminUser() {
        const adminPassword = await bcrypt.hash('@Admin4040', 10);
        
        this.db.run(`
            INSERT OR IGNORE INTO users (username, password, role) 
            VALUES (?, ?, ?)
        `, ['IT', adminPassword, 'admin'], (err) => {
            if (err) {
                console.error('❌ Error creating admin user:', err);
            } else {
                console.log('✅ Admin user created: IT / @Admin4040');
            }
        });
    }

    // User management methods
    async createUser(username, password, role = 'user') {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO users (username, password, role) 
                VALUES (?, ?, ?)
            `, [username, hashedPassword, role], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, username, role });
                }
            });
        });
    }

    async authenticateUser(username, password) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT * FROM users 
                WHERE username = ? AND is_active = 1
            `, [username], async (err, row) => {
                if (err) {
                    reject(err);
                } else if (row && await bcrypt.compare(password, row.password)) {
                    resolve(row);
                } else {
                    resolve(null);
                }
            });
        });
    }

    async getUserById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT id, username, role FROM users WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getAllUsers() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT id, username, role, created_at FROM users WHERE is_active = 1', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Conversation methods
    async saveMessage(userId, clientPhone, message, isFromMe = false) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO conversations (user_id, client_phone, message_text, is_from_me) 
                VALUES (?, ?, ?, ?)
            `, [userId, clientPhone, message, isFromMe ? 1 : 0], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    }

    async getConversationHistory(userId, clientPhone, limit = 50) {
        return new Promise((resolve, reject) => {
            // If user is admin, show all messages. If regular user, only show their messages
            const query = userId === 'admin' ? 
                `SELECT * FROM conversations 
                 WHERE client_phone = ? 
                 ORDER BY created_at DESC LIMIT ?` :
                `SELECT * FROM conversations 
                 WHERE client_phone = ? AND (user_id = ? OR user_id IS NULL) 
                 ORDER BY created_at DESC LIMIT ?`;
            
            const params = userId === 'admin' ? [clientPhone, limit] : [clientPhone, userId, limit];
            
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows.reverse()); // Return in chronological order
            });
        });
    }

    // Client status methods
    async updateClientStatus(clientPhone, status, userId = null) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT OR REPLACE INTO client_status (client_phone, status, user_id, last_contact)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, [clientPhone, status, userId], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getClientStatus(clientPhone) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM client_status WHERE client_phone = ?', [clientPhone], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getAllClients(userId) {
        const query = userId === 'admin' ? 
            `SELECT DISTINCT client_phone FROM conversations 
             UNION 
             SELECT client_phone FROM client_status` :
            `SELECT DISTINCT client_phone FROM conversations 
             WHERE user_id = ? 
             UNION 
             SELECT client_phone FROM client_status WHERE user_id = ?`;
        
        const params = userId === 'admin' ? [] : [userId, userId];
        
        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.client_phone));
            });
        });
    }

    close() {
        this.db.close();
    }
}

// ✅ CORRECT EXPORT - Export the class, not an instance
module.exports = Database;
