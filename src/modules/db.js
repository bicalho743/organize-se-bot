const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/bot.db');

let db;

function initDB() {
  const fs = require('fs');
  const dataDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY,
      product_name TEXT NOT NULL,
      price REAL,
      original_price REAL,
      discount_pct REAL,
      affiliate_link TEXT NOT NULL,
      image_url TEXT,
      rating REAL,
      sales_count INTEGER,
      category TEXT,
      generated_post TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      posted_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS posted_history (
      id TEXT PRIMARY KEY,
      product_name TEXT,
      tweet_id TEXT,
      tweet_url TEXT,
      post_text TEXT,
      category TEXT,
      posted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      state TEXT DEFAULT 'idle',
      pending_post TEXT,
      pending_product TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_count (
      date TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0
    );
  `);

  console.log('[DB] Banco iniciado com sucesso.');
  return db;
}

function getDB() {
  if (!db) throw new Error('DB não iniciado. Chame initDB() primeiro.');
  return db;
}

// Queue
function addToQueue(product) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  const stmt = getDB().prepare(`
    INSERT OR IGNORE INTO queue 
    (id, product_name, price, original_price, discount_pct, affiliate_link, image_url, rating, sales_count, category, generated_post)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, product.name, product.price, product.originalPrice, product.discountPct,
    product.affiliateLink, product.imageUrl, product.rating, product.salesCount,
    product.category, product.generatedPost || null);
  return id;
}

function getNextInQueue() {
  return getDB().prepare(`
    SELECT * FROM queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1
  `).get();
}

function markAsPosted(id, tweetId, tweetUrl) {
  getDB().prepare(`UPDATE queue SET status = 'posted', posted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  const item = getDB().prepare(`SELECT * FROM queue WHERE id = ?`).get(id);
  if (item) {
    getDB().prepare(`
      INSERT INTO posted_history (id, product_name, tweet_id, tweet_url, post_text, category)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(item.id, item.product_name, tweetId, tweetUrl, item.generated_post, item.category);
  }
}

function markAsIgnored(id) {
  getDB().prepare(`UPDATE queue SET status = 'ignored' WHERE id = ?`).run(id);
}

function getPendingCount() {
  return getDB().prepare(`SELECT COUNT(*) as count FROM queue WHERE status = 'pending'`).get().count;
}

function getQueueList() {
  return getDB().prepare(`SELECT * FROM queue WHERE status = 'pending' ORDER BY created_at ASC`).all();
}

// Daily count
function getTodayCount() {
  const today = new Date().toISOString().split('T')[0];
  const row = getDB().prepare(`SELECT count FROM daily_count WHERE date = ?`).get(today);
  return row ? row.count : 0;
}

function incrementTodayCount() {
  const today = new Date().toISOString().split('T')[0];
  getDB().prepare(`
    INSERT INTO daily_count (date, count) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET count = count + 1
  `).run(today);
}

// Sessions
function getSession(chatId) {
  return getDB().prepare(`SELECT * FROM sessions WHERE chat_id = ?`).get(String(chatId));
}

function setSession(chatId, data) {
  const existing = getSession(chatId);
  if (existing) {
    getDB().prepare(`
      UPDATE sessions SET state = ?, pending_post = ?, pending_product = ?, updated_at = CURRENT_TIMESTAMP
      WHERE chat_id = ?
    `).run(data.state || 'idle', data.pendingPost || null, data.pendingProduct ? JSON.stringify(data.pendingProduct) : null, String(chatId));
  } else {
    getDB().prepare(`
      INSERT INTO sessions (chat_id, state, pending_post, pending_product) VALUES (?, ?, ?, ?)
    `).run(String(chatId), data.state || 'idle', data.pendingPost || null, data.pendingProduct ? JSON.stringify(data.pendingProduct) : null);
  }
}

// History
function getRecentPosts(limit = 10) {
  return getDB().prepare(`SELECT * FROM posted_history ORDER BY posted_at DESC LIMIT ?`).all(limit);
}

function wasPostedRecently(productName, hoursAgo = 24) {
  const threshold = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  const row = getDB().prepare(`
    SELECT id FROM posted_history WHERE product_name = ? AND posted_at > ?
  `).get(productName, threshold);
  return !!row;
}

module.exports = {
  initDB, getDB,
  addToQueue, getNextInQueue, markAsPosted, markAsIgnored, getPendingCount, getQueueList,
  getTodayCount, incrementTodayCount,
  getSession, setSession,
  getRecentPosts, wasPostedRecently
};
