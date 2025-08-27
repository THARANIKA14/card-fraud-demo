// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');
const utils = require('./utils');
const { nanoid } = require('nanoid');
const axios = require('axios');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// serve frontend
app.use(express.static(path.join(__dirname, 'public')));


// --- API: Check card usage / detect fraud
app.post('/api/check', async (req, res) => {
  try {
    const { cardNumber, lat, lon, ts } = req.body;
    if (!cardNumber) return res.status(400).json({ error: 'cardNumber is required' });

    const now = ts || new Date().toISOString();
    let curLat = (lat !== undefined ? lat : null);
    let curLon = (lon !== undefined ? lon : null);

    // If frontend didn't provide coords, attempt a server-side fallback using ipapi.co
    // NOTE: server-side ipapi call will return server location on many hosts; frontend fallback is preferred.
    if ((curLat === null || curLon === null)) {
      try {
        const r = await axios.get('https://ipapi.co/json/');
        if (r.data && r.data.latitude && r.data.longitude) {
          curLat = r.data.latitude;
          curLon = r.data.longitude;
        }
      } catch (e) {
        console.warn('ipapi fallback failed:', e.message);
      }
    }

    // load/create card
    let card = db.getCard(cardNumber);
    if (!card) {
      card = {
        cardNumber,
        lastSeen: null,
        status: 'active',
        reported: false,
        history: []
      };
    }

    // compute risk
    let risk = 'LOW';
    let details = {};
    if (card.lastSeen && curLat != null && curLon != null) {
      const distKm = utils.haversineDistance(card.lastSeen.lat, card.lastSeen.lon, curLat, curLon);
      const lastTs = new Date(card.lastSeen.timestamp);
      const diffHours = Math.abs((new Date(now) - lastTs) / (1000 * 60 * 60));

      details.distance_km = Number(distKm.toFixed(2));
      details.hours_since_last = Number(diffHours.toFixed(2));

      // simple rule-based scoring:
      if (distKm > 500 && diffHours < 6) risk = 'HIGH';
      else if (distKm > 100 && diffHours < 24) risk = 'MEDIUM';
      else risk = 'LOW';
    } else {
      details.note = 'No previous location for this card (first time or missing).';
    }

    // status overrides
    if (card.status === 'blocked') risk = 'BLOCKED';
    if (card.status === 'frozen') risk = 'FROZEN';

    // record history & update lastSeen
    const entry = {
      id: nanoid(),
      lat: curLat,
      lon: curLon,
      timestamp: now,
      risk,
      action: 'checked'
    };
    db.addHistory(cardNumber, entry);
    db.updateLastSeen(cardNumber, { lat: curLat, lon: curLon, timestamp: now });

    // if high risk, trigger an alert
    if (risk === 'HIGH') {
      sendAlertEmail(
        process.env.ADMIN_EMAIL,
        `ALERT: HIGH risk for card ${mask(cardNumber)}`,
        `Detected HIGH risk for card ${mask(cardNumber)} at ${now}. Details: ${JSON.stringify(details)}`
      );
    }

    // return a safe payload (mask card number)
    const saved = db.getCard(cardNumber);
    res.json({
      card: {
        cardNumber: mask(cardNumber),
        status: saved.status,
        reported: saved.reported,
        lastSeen: saved.lastSeen
      },
      risk,
      details
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


// --- API: Actions (report / freeze / block / continue)
app.post('/api/action', (req, res) => {
  try {
    const { cardNumber, action } = req.body;
    if (!cardNumber || !action) return res.status(400).json({ error: 'cardNumber and action required' });

    let card = db.getCard(cardNumber);
    if (!card) {
      card = { cardNumber, lastSeen: null, status: 'active', reported: false, history: [] };
    }

    let message = '';
    switch (action) {
      case 'continue':
        message = 'Transaction allowed (no action taken).';
        break;
      case 'report':
        card.reported = true;
        message = 'Card reported.';
        break;
      case 'freeze':
        card.status = 'frozen';
        message = 'Card frozen.';
        break;
      case 'block':
        card.status = 'blocked';
        message = 'Card blocked.';
        break;
      default:
        return res.status(400).json({ error: 'unknown action' });
    }

    db.saveCard(card);
    db.addHistory(cardNumber, { id: nanoid(), timestamp: new Date().toISOString(), action });

    sendAlertEmail(
      process.env.ADMIN_EMAIL,
      `Action ${action} performed for card ${mask(cardNumber)}`,
      `Action ${action} performed on ${new Date().toISOString()} for card ${mask(cardNumber)}`
    );

    res.json({ ok: true, message, card: { cardNumber: mask(cardNumber), status: card.status, reported: card.reported } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


// Optional: list cards (for demo)
app.get('/api/cards', (req, res) => {
  res.json(db.getAllCards());
});


function mask(pan) {
  if (!pan) return '';
  const s = String(pan).replace(/\s+/g, '');
  if (s.length <= 4) return '****';
  return '**** **** **** ' + s.slice(-4);
}


// Simple email alert with nodemailer (falls back to console.log if SMTP not configured)
async function sendAlertEmail(to, subject, text) {
  if (!to) {
    console.log('ALERT (no ADMIN_EMAIL set) ->', { subject, text });
    return;
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.log('ALERT (SMTP not configured) ->', { to, subject, text });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject,
      text
    });
    console.log('Alert email sent to', to);
  } catch (e) {
    console.error('Failed to send alert email', e.message);
  }
}


app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
