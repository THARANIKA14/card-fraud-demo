// db.js
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ cards: [] }, null, 2));
}

function readDB() {
  ensure();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getCard(cardNumber) {
  const db = readDB();
  return db.cards.find(c => c.cardNumber === cardNumber);
}

function saveCard(card) {
  const db = readDB();
  const idx = db.cards.findIndex(c => c.cardNumber === card.cardNumber);
  if (idx === -1) db.cards.push(card);
  else db.cards[idx] = card;
  writeDB(db);
}

function addHistory(cardNumber, entry) {
  let card = getCard(cardNumber);
  if (!card) {
    card = { cardNumber, lastSeen: null, status: 'active', reported: false, history: [] };
  }
  card.history = card.history || [];
  card.history.unshift(entry);
  // keep history to a reasonable length for demo
  if (card.history.length > 200) card.history = card.history.slice(0, 200);
  saveCard(card);
}

function updateLastSeen(cardNumber, lastSeen) {
  let card = getCard(cardNumber);
  if (!card) {
    card = { cardNumber, lastSeen: null, status: 'active', reported: false, history: [] };
  }
  card.lastSeen = lastSeen;
  saveCard(card);
}

function getAllCards() {
  const db = readDB();
  return db.cards;
}

module.exports = { getCard, saveCard, addHistory, updateLastSeen, getAllCards };
