'use strict';

const form = document.getElementById('messageForm');
const message = document.getElementById('message');
const counter = document.getElementById('counter');
const status = document.getElementById('status');
const button = document.getElementById('submitButton');
const intro = document.getElementById('intro');
const tracking = document.getElementById('tracking');
const trackingTitle = document.getElementById('trackingTitle');
const trackingDetail = document.getElementById('trackingDetail');

const CLIENT_KEY = 'nools-public-client';
const RECEIPT_KEY = 'nools-public-message-receipt';
let activeReceipt = null;
let trackingTimer = null;
let cooldownTimer = null;

function randomClientId() {
  const bytes = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return 'browser-' + [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  return `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function storedValue(key) {
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}

function storeValue(key, value) {
  try { window.localStorage.setItem(key, value); }
  catch {}
}

let clientId = storedValue(CLIENT_KEY);
if (!clientId || !/^[a-zA-Z0-9_-]{16,100}$/.test(clientId)) {
  clientId = randomClientId();
  storeValue(CLIENT_KEY, clientId);
}

function setTracking(title, detail) {
  tracking.classList.add('show');
  trackingTitle.textContent = title;
  trackingDetail.textContent = detail;
}

function renderMessageStatus(result) {
  switch (result.status) {
    case 'pending':
      setTracking(
        'En attente de validation',
        result.pendingPosition
          ? `Demande n°${result.pendingPosition} dans la liste de modération.`
          : 'L\u2019équipe va examiner ton message.'
      );
      break;
    case 'approved':
      setTracking(
        'Message validé',
        result.position
          ? `Position ${result.position} dans la file. Il apparaîtra entre les autres visuels.`
          : 'Il apparaîtra bientôt entre les autres visuels.'
      );
      break;
    case 'playing':
      setTracking('Ton message est à l\u2019écran !', 'Regarde le panneau maintenant.');
      break;
    case 'displayed':
      setTracking('Message affiché', 'Merci pour ta participation.');
      stopTracking();
      break;
    case 'rejected':
      setTracking('Message non retenu', 'Tu pourras proposer un autre message un peu plus tard.');
      stopTracking();
      break;
    default:
      setTracking('Message reçu', 'Le serveur prépare son affichage.');
  }
}

function stopTracking() {
  if (trackingTimer) window.clearInterval(trackingTimer);
  trackingTimer = null;
}

async function pollMessageStatus() {
  if (!activeReceipt || !activeReceipt.id || !activeReceipt.receipt) return;
  try {
    const response = await fetch(
      `/api/public/messages/${encodeURIComponent(activeReceipt.id)}/status?receipt=${encodeURIComponent(activeReceipt.receipt)}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return;
    renderMessageStatus(await response.json());
  } catch {}
}

function trackReceipt(receipt) {
  activeReceipt = { id: receipt.id, receipt: receipt.receipt };
  storeValue(RECEIPT_KEY, JSON.stringify(activeReceipt));
  stopTracking();
  pollMessageStatus();
  trackingTimer = window.setInterval(pollMessageStatus, 2000);
}

function startCooldown(seconds, errorMessage) {
  let remaining = Math.max(1, Number(seconds) || 1);
  if (cooldownTimer) window.clearInterval(cooldownTimer);
  button.disabled = true;
  const refresh = () => {
    status.className = 'error';
    status.textContent = `${errorMessage} (${remaining}s)`;
    remaining -= 1;
    if (remaining < 0) {
      window.clearInterval(cooldownTimer);
      cooldownTimer = null;
      button.disabled = false;
      status.textContent = '';
    }
  };
  refresh();
  cooldownTimer = window.setInterval(refresh, 1000);
}

async function loadPublicConfig() {
  try {
    const response = await fetch('/api/public/messages/config', { cache: 'no-store' });
    if (!response.ok) return;
    const config = await response.json();
    intro.textContent = config.mode === 'moderated'
      ? 'Ton message sera envoyé à l\u2019équipe, puis ajouté à la file après validation.'
      : 'Ton message sera ajouté à la file et apparaîtra entre les autres visuels.';
  } catch {}
}

message.addEventListener('input', () => {
  counter.textContent = `${[...message.value].length} / 80`;
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  status.className = '';
  status.textContent = 'Envoi…';
  try {
    const response = await fetch('/api/public/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: message.value,
        color: document.getElementById('color').value,
        rainbow: document.getElementById('rainbow').checked,
        clientId,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.retryAfterSeconds) {
        startCooldown(result.retryAfterSeconds, result.error || 'Patiente avant le prochain envoi.');
      }
      throw new Error(result.error || 'Envoi impossible.');
    }
    status.className = 'ok';
    status.textContent = result.status === 'pending'
      ? 'Message envoyé à la modération.'
      : 'Message ajouté à la file !';
    message.value = '';
    counter.textContent = '0 / 80';
    renderMessageStatus(result);
    trackReceipt(result);
  } catch (error) {
    if (!cooldownTimer) {
      status.className = 'error';
      status.textContent = error.message || 'Le panneau ne répond pas.';
    }
  } finally {
    if (!cooldownTimer) button.disabled = false;
  }
});

loadPublicConfig();
try {
  const previous = JSON.parse(storedValue(RECEIPT_KEY) || 'null');
  if (previous && previous.id && previous.receipt) trackReceipt(previous);
} catch {}
