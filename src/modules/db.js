const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/bot.db');
const DATA_DIR = path.join(__dirname, '../../data');

let db;

// Salva o banco em disco após cada escrita
function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
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
      created_at TEXT DEFAULT (datetime('now')),
      posted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS posted_history (
      id TEXT PRIMARY KEY,
      product_name TEXT,
      tweet_id TEXT,
      tweet_url TEXT,
      post_text TEXT,
      category TEXT,
      posted_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      state TEXT DEFAULT 'idle',
      pending_post TEXT,
      pending_product TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_count (
      date TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  persist();
  console.log('[DB] Banco iniciado com sucesso.');
  return db;
}

function getDB() {
  if (!db) throw new Error('DB não iniciado. Chame initDB() primeiro.');
  return db;
}

function runQuery(sql, params = []) {
  db.run(sql, params);
  persist();
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Queue
function addToQueue(product) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  runQuery(`
    INSERT OR IGNORE INTO queue 
    (id, product_name, price, original_price, discount_pct, affiliate_link, image_url, rating, sales_count, category, generated_post)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, product.name, product.price, product.originalPrice, product.discountPct,
      product.affiliateLink, product.imageUrl || null, product.rating || null,
      product.salesCount || null, product.category || null, product.generatedPost || null]);
  return id;
}

function getNextInQueue() {
  return getOne(`SELECT * FROM queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`);
}

function markAsPosted(id, tweetId, tweetUrl) {
  const item = getOne(`SELECT * FROM queue WHERE id = ?`, [id]);
  runQuery(`UPDATE queue SET status = 'posted', posted_at = datetime('now') WHERE id = ?`, [id]);
  if (item) {
    runQuery(`
      INSERT INTO posted_history (id, product_name, tweet_id, tweet_url, post_text, category)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [item.id, item.product_name, tweetId, tweetUrl, item.generated_post, item.category]);
  }
}

function markAsIgnored(id) {
  runQuery(`UPDATE queue SET status = 'ignored' WHERE id = ?`, [id]);
}

function getPendingCount() {
  const row = getOne(`SELECT COUNT(*) as count FROM queue WHERE status = 'pending'`);
  return row ? row.count : 0;
}

function getQueueList() {
  return getAll(`SELECT * FROM queue WHERE status = 'pending' ORDER BY created_at ASC`);
}

function getQueueItemById(id) {
  return getOne(`SELECT * FROM queue WHERE id = ?`, [id]);
}

function updateQueuePost(id, newPost) {
  runQuery(`UPDATE queue SET generated_post = ? WHERE id = ?`, [newPost, id]);
}

function clearPendingQueue() {
  runQuery(`UPDATE queue SET status = 'ignored' WHERE status = 'pending'`);
}

// Daily count
function getTodayCount() {
  const today = new Date().toISOString().split('T')[0];
  const row = getOne(`SELECT count FROM daily_count WHERE date = ?`, [today]);
  return row ? row.count : 0;
}

function incrementTodayCount() {
  const today = new Date().toISOString().split('T')[0];
  runQuery(`
    INSERT INTO daily_count (date, count) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET count = count + 1
  `, [today]);
}

// Sessions
function getSession(chatId) {
  return getOne(`SELECT * FROM sessions WHERE chat_id = ?`, [String(chatId)]);
}

function setSession(chatId, data) {
  const existing = getSession(chatId);
  const pendingProduct = data.pendingProduct ? JSON.stringify(data.pendingProduct) : null;
  if (existing) {
    runQuery(`
      UPDATE sessions SET state = ?, pending_post = ?, pending_product = ?, updated_at = datetime('now')
      WHERE chat_id = ?
    `, [data.state || 'idle', data.pendingPost || null, pendingProduct, String(chatId)]);
  } else {
    runQuery(`
      INSERT INTO sessions (chat_id, state, pending_post, pending_product) VALUES (?, ?, ?, ?)
    `, [String(chatId), data.state || 'idle', data.pendingPost || null, pendingProduct]);
  }
}

// History
function getRecentPosts(limit = 10) {
  return getAll(`SELECT * FROM posted_history ORDER BY posted_at DESC LIMIT ?`, [limit]);
}

function wasPostedRecently(productName, hoursAgo = 48) {
  const threshold = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  const row = getOne(`
    SELECT id FROM posted_history WHERE product_name = ? AND posted_at > ?
  `, [productName, threshold]);
  return !!row;
}

module.exports = {
  initDB, getDB,
  addToQueue, getNextInQueue, markAsPosted, markAsIgnored,
  getPendingCount, getQueueList, getQueueItemById, updateQueuePost, clearPendingQueue,
  getTodayCount, incrementTodayCount,
  getSession, setSession,
  getRecentPosts, wasPostedRecently,
  persist, runQuery, getOne
};
