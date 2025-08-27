// public/app.js

const form = document.getElementById('checkForm');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const cardInfoEl = document.getElementById('cardInfo');
const riskInfoEl = document.getElementById('riskInfo');
const detailsEl = document.getElementById('details');

const btnContinue = document.getElementById('btnContinue');
const btnReport = document.getElementById('btnReport');
const btnFreeze = document.getElementById('btnFreeze');
const btnBlock = document.getElementById('btnBlock');

let lastResponse = null;
let lastCardNumberRaw = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cardNumber = document.getElementById('cardNumber').value.trim();
  if (!cardNumber) return alert('Enter card number');
  lastCardNumberRaw = cardNumber;
  setStatus('Getting location...');
  resultEl.classList.add('hidden');
  try {
    let coords;
    try {
      coords = await tryGetBrowserLocation();
    } catch (err) {
      setStatus('Location denied or failed — using IP fallback');
      coords = await ipFallback();
    }
    setStatus('Checking card...');
    const payload = {
      cardNumber,
      lat: coords.latitude,
      lon: coords.longitude,
      ts: new Date().toISOString()
    };
    const r = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    lastResponse = data;
    renderResult(data, coords);
    setStatus('Done');
  } catch (err) {
    console.error(err);
    setStatus('Error. See console.');
  }
});

async function tryGetBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No geolocation'));
    navigator.geolocation.getCurrentPosition(pos => {
      resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    }, err => {
      reject(err);
    }, { timeout: 10000 });
  });
}

async function ipFallback() {
  // ipapi.co JSON endpoint (free tier for dev)
  const r = await fetch('https://ipapi.co/json/');
  const j = await r.json();
  return { latitude: j.latitude, longitude: j.longitude, city: j.city, country: j.country_name };
}

function renderResult(data, coords) {
  resultEl.classList.remove('hidden');
  const { card, risk, details } = data;
  cardInfoEl.innerHTML = `<strong>Card:</strong> ${card.cardNumber} • <strong>Status:</strong> ${card.status} • <strong>Reported:</strong> ${card.reported}`;
  riskInfoEl.innerHTML = `<strong>Risk:</strong> ${risk}`;
  let d = `<pre>${JSON.stringify(details, null, 2)}</pre>`;
  if (card.lastSeen && card.lastSeen.lat && card.lastSeen.lon) {
    const mapLink = `https://www.google.com/maps?q=${card.lastSeen.lat},${card.lastSeen.lon}`;
    d += `<p><strong>Last seen:</strong> ${card.lastSeen.timestamp} • <a href="${mapLink}" target="_blank">view on map</a></p>`;
  }
  if (coords && coords.latitude) {
    d += `<p><strong>Your detected coords:</strong> ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)} • <a href="https://www.google.com/maps?q=${coords.latitude},${coords.longitude}" target="_blank">view</a></p>`;
  }
  d += `<p><small>Note: This is a demo. Data is stored locally in the server's data/db.json file.</small></p>`;
  detailsEl.innerHTML = d;
}

// action buttons
async function doAction(action) {
  if (!lastCardNumberRaw) return alert('Run a check first.');
  const r = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardNumber: lastCardNumberRaw, action })
  });
  const j = await r.json();
  alert(j.message || 'OK');
  // refresh view quickly
  document.getElementById('checkForm').dispatchEvent(new Event('submit'));
}

btnContinue.addEventListener('click', () => doAction('continue'));
btnReport.addEventListener('click', () => doAction('report'));
btnFreeze.addEventListener('click', () => {
  if (!confirm('Freeze this card?')) return;
  doAction('freeze');
});
btnBlock.addEventListener('click', () => {
  if (!confirm('Block this card? This is irreversible in demo.')) return;
  doAction('block');
});

function setStatus(t) {
  statusEl.textContent = t;
}
