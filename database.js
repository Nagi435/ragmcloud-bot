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

    // ... rest of your database code remains the same ...
}
