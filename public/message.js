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
let sending = false;

function setSubmissionDisabled(disabled) {
  button.disabled = disabled;
  document.getElementById('gifSubmit').disabled = disabled;
}

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
  const noun = result.kind === 'gif' ? 'GIF' : 'Message';
  switch (result.status) {
    case 'pending':
      setTracking(
        'En attente de validation',
        result.pendingPosition
          ? `Demande n°${result.pendingPosition} dans la liste de modération.`
          : 'L\u2019équipe va examiner ton envoi.'
      );
      break;
    case 'approved':
      setTracking(
        `${noun} validé`,
        result.position
          ? `Position ${result.position} dans la file. Il apparaîtra entre les autres visuels.`
          : 'Il apparaîtra bientôt entre les autres visuels.'
      );
      break;
    case 'playing':
      setTracking(`Ton ${noun.toLowerCase()} est à l’écran !`, 'Regarde le panneau maintenant.');
      break;
    case 'displayed':
      setTracking(`${noun} affiché`, 'Merci pour ta participation.');
      stopTracking();
      break;
    case 'rejected':
      setTracking(`${noun} non retenu`, 'Tu pourras proposer une autre création un peu plus tard.');
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
  setSubmissionDisabled(true);
  const refresh = () => {
    status.className = 'error';
    status.textContent = `${errorMessage} (${remaining}s)`;
    remaining -= 1;
    if (remaining < 0) {
      window.clearInterval(cooldownTimer);
      cooldownTimer = null;
      setSubmissionDisabled(false);
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
      ? 'Messages et GIF seront ajoutés à la file après validation par l’équipe.'
      : 'Les messages rejoignent la file directement. Les GIF sont vérifiés par l’équipe avant diffusion.';
  } catch {}
}

const allowLowercase = document.getElementById('allowLowercase');
function updateMessageCase() {
  message.style.textTransform = allowLowercase.checked ? 'none' : 'uppercase';
  message.setAttribute('autocapitalize', allowLowercase.checked ? 'none' : 'characters');
  const text = allowLowercase.checked ? message.value : message.value.toLocaleUpperCase('fr-FR');
  counter.textContent = `${[...text].length} / 80`;
  message.setCustomValidity([...text].length > 80 ? 'Maximum 80 caractères après conversion en majuscules.' : '');
}
message.addEventListener('input', updateMessageCase);
allowLowercase.addEventListener('change', updateMessageCase);
updateMessageCase();

async function submitCreation(endpoint, payload) {
  if (sending || cooldownTimer) return;
  sending = true;
  setSubmissionDisabled(true);
  status.className = '';
  status.textContent = 'Envoi…';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
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
      ? 'Envoi reçu par l’équipe pour validation.'
      : 'Message ajouté à la file !';
    if (endpoint === '/api/public/message') {
      message.value = '';
      counter.textContent = '0 / 80';
    }
    renderMessageStatus(result);
    trackReceipt(result);
  } catch (error) {
    if (!cooldownTimer) {
      status.className = 'error';
      status.textContent = error.message || 'Le panneau ne répond pas.';
    }
  } finally {
    sending = false;
    if (!cooldownTimer) setSubmissionDisabled(false);
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  submitCreation('/api/public/message', {
    text: message.value,
    allowLowercase: allowLowercase.checked,
    color: document.getElementById('color').value,
    rainbow: document.getElementById('rainbow').checked,
  });
});

window.addEventListener('public-gif-submit', event => submitCreation('/api/public/gif', event.detail));

loadPublicConfig();
try {
  const previous = JSON.parse(storedValue(RECEIPT_KEY) || 'null');
  if (previous && previous.id && previous.receipt) trackReceipt(previous);
} catch {}
