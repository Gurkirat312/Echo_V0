const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'dating.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    name TEXT,
    age INTEGER,
    bio TEXT,
    gender TEXT,
    interested_in TEXT,
    profile_pic TEXT,
    location TEXT,
    job TEXT,
    school TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Photos table
  db.run(`CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    url TEXT,
    "order" INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Prompts table
  db.run(`CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    question TEXT,
    answer TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Likes table (Enhanced for Hinge style)
  db.run(`CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    liker_id INTEGER,
    liked_id INTEGER,
    target_type TEXT, -- 'photo' or 'prompt' or 'profile'
    target_id INTEGER, -- id of the photo or prompt
    status TEXT DEFAULT 'pending', -- 'pending' or 'matched'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(liker_id) REFERENCES users(id),
    FOREIGN KEY(liked_id) REFERENCES users(id)
  )`);

  // Messages table
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(receiver_id) REFERENCES users(id)
  )`);
});

module.exports = db;
