const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET = process.env.JWT_SECRET || 'echo_secret_key_123';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// --- AUTH ROUTES ---

app.post('/api/register', async (req, res) => {
  const { username, email, password, name, age, gender, interested_in } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  const query = `INSERT INTO users (username, email, password, name, age, gender, interested_in) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.run(query, [username, email, hashedPassword, name, age, gender, interested_in], function(err) {
    if (err) return res.status(400).json({ error: err.message });
    const token = jwt.sign({ id: this.lastID }, SECRET);
    res.json({ token, user: { id: this.lastID, username, name } });
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid password' });
    const token = jwt.sign({ id: user.id }, SECRET);
    res.json({ token, user: { id: user.id, username: user.username, name: user.name } });
  });
});

// --- PROFILE ROUTES ---

app.get('/api/profile', authenticateToken, (req, res) => {
  db.get(`SELECT id, username, email, name, age, bio, gender, interested_in, profile_pic, location, job, school FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.all(`SELECT * FROM photos WHERE user_id = ? ORDER BY "order" ASC`, [req.user.id], (err, photos) => {
      db.all(`SELECT * FROM prompts WHERE user_id = ?`, [req.user.id], (err, prompts) => {
        res.json({ ...user, photos, prompts });
      });
    });
  });
});

app.post('/api/profile/update', authenticateToken, (req, res) => {
  const { name, age, bio, gender, interested_in, location, job, school, prompts } = req.body;
  
  const query = `UPDATE users SET name=?, age=?, bio=?, gender=?, interested_in=?, location=?, job=?, school=? WHERE id=?`;
  db.run(query, [name, age, bio, gender, interested_in, location, job, school, req.user.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    
    // Update prompts
    if (prompts && Array.isArray(prompts)) {
      db.run(`DELETE FROM prompts WHERE user_id = ?`, [req.user.id], () => {
        const stmt = db.prepare(`INSERT INTO prompts (user_id, question, answer) VALUES (?, ?, ?)`);
        prompts.forEach(p => stmt.run(req.user.id, p.question, p.answer));
        stmt.finalize();
      });
    }
    
    res.json({ success: true });
  });
});

app.post('/api/profile/upload-photo', authenticateToken, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  
  db.get(`SELECT COUNT(*) as count FROM photos WHERE user_id = ?`, [req.user.id], (err, row) => {
    const order = row.count;
    db.run(`INSERT INTO photos (user_id, url, "order") VALUES (?, ?, ?)`, [req.user.id, url, order], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, url, order });
    });
  });
});

// --- DISCOVERY ROUTES ---

app.get('/api/users/discover', authenticateToken, (req, res) => {
  // Get users not already liked/disliked by current user
  const query = `
    SELECT id, name, age, bio, profile_pic, gender, location, job, school 
    FROM users 
    WHERE id != ? 
    AND id NOT IN (SELECT liked_id FROM likes WHERE liker_id = ?)
    LIMIT 20
  `;
  db.all(query, [req.user.id, req.user.id], (err, users) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // For each user, get their photos and prompts
    const userPromises = users.map(user => {
      return new Promise((resolve) => {
        db.all(`SELECT * FROM photos WHERE user_id = ? ORDER BY "order" ASC`, [user.id], (err, photos) => {
          db.all(`SELECT * FROM prompts WHERE user_id = ?`, [user.id], (err, prompts) => {
            resolve({ ...user, photos, prompts });
          });
        });
      });
    });

    Promise.all(userPromises).then(results => res.json(results));
  });
});

// --- LIKE/MATCH ROUTES ---

app.post('/api/like', authenticateToken, (req, res) => {
  const { liked_id, target_type, target_id } = req.body;
  const liker_id = req.user.id;

  // Check if the other person already liked this user
  db.get(`SELECT * FROM likes WHERE liker_id = ? AND liked_id = ?`, [liked_id, liker_id], (err, row) => {
    if (row) {
      // It's a match!
      db.run(`UPDATE likes SET status = 'matched' WHERE id = ?`, [row.id]);
      db.run(`INSERT INTO likes (liker_id, liked_id, target_type, target_id, status) VALUES (?, ?, ?, ?, 'matched')`, [liker_id, liked_id, target_type, target_id]);
      return res.json({ match: true });
    } else {
      // Just a like
      db.run(`INSERT INTO likes (liker_id, liked_id, target_type, target_id, status) VALUES (?, ?, ?, ?, 'pending')`, [liker_id, liked_id, target_type, target_id]);
      return res.json({ match: false });
    }
  });
});

app.get('/api/matches', authenticateToken, (req, res) => {
  const query = `
    SELECT u.id, u.name, u.profile_pic 
    FROM users u 
    JOIN likes l ON u.id = l.liked_id 
    WHERE l.liker_id = ? AND l.status = 'matched'
  `;
  db.all(query, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/likes-received', authenticateToken, (req, res) => {
  const query = `
    SELECT u.id, u.name, u.profile_pic, u.age, u.bio, l.target_type, l.target_id
    FROM users u
    JOIN likes l ON u.id = l.liker_id
    WHERE l.liked_id = ? AND l.status = 'pending'
    AND u.id NOT IN (SELECT liked_id FROM likes WHERE liker_id = ?)
  `;
  db.all(query, [req.user.id, req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- CHAT ROUTES ---

app.post('/api/messages/send', authenticateToken, (req, res) => {
  const { receiver_id, content } = req.body;
  const sender_id = req.user.id;

  const query = `INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)`;
  db.run(query, [sender_id, receiver_id, content], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, sender_id, receiver_id, content, timestamp: new Date() });
  });
});

app.get('/api/messages/:otherId', authenticateToken, (req, res) => {
  const { otherId } = req.params;
  const userId = req.user.id;

  const query = `
    SELECT * FROM messages 
    WHERE (sender_id = ? AND receiver_id = ?) 
    OR (sender_id = ? AND receiver_id = ?)
    ORDER BY timestamp ASC
  `;
  db.all(query, [userId, otherId, otherId, userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- SEED DATA (Internal Helper) ---
app.get('/api/seed', async (req, res) => {
  const users = [
    { username: 'alice', name: 'Alice Smith', email: 'alice@example.com', age: 24, bio: 'Adventurer and coffee lover.', profile_pic: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400', gender: 'female', location: 'London', job: 'Designer', school: 'UCL' },
    { username: 'bob', name: 'Bob Jones', email: 'bob@example.com', age: 27, bio: 'Photography is my life.', profile_pic: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400', gender: 'male', location: 'New York', job: 'Architect', school: 'NYU' },
    { username: 'charlie', name: 'Charlie Day', email: 'charlie@example.com', age: 22, bio: 'Student and gamer.', profile_pic: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400', gender: 'male', location: 'Philadelphia', job: 'Waitress', school: 'PENN' },
    { username: 'diana', name: 'Diana Prince', email: 'diana@example.com', age: 26, bio: 'Love hiking and outdoors.', profile_pic: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400', gender: 'female', location: 'Themyscira', job: 'Warrior', school: 'Home School' }
  ];

  for (let u of users) {
    const hp = await bcrypt.hash('password123', 10);
    db.run(`INSERT OR IGNORE INTO users (username, email, password, name, age, bio, profile_pic, gender, location, job, school) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [u.username, u.email, hp, u.name, u.age, u.bio, u.profile_pic, u.gender, u.location, u.job, u.school], function(err) {
        if (this.lastID) {
          const userId = this.lastID;
          // Add dummy photos
          db.run(`INSERT INTO photos (user_id, url, "order") VALUES (?, ?, ?)`, [userId, u.profile_pic, 0]);
          // Add dummy prompts
          db.run(`INSERT INTO prompts (user_id, question, answer) VALUES (?, ?, ?)`, [userId, 'The hallmark of a good relationship is...', 'Communication and mutual respect.']);
        }
      });
  }
  res.send('Database seeded with dummy users, photos, and prompts.');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
