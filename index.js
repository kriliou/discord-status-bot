require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

const app = express();
app.use(express.json());

const DATA_FILE = path.join(__dirname, 'sites.json');
const PORT = process.env.PORT || 3000;

// --- Chiffrement AES ---
const ENCRYPTION_KEY = crypto.createHash('sha256').update(String(process.env.MASTER_KEY)).digest();
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// --- Chargement des sites ---
let sites = [];
function loadSites() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      sites = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error('Erreur lecture sites.json:', e);
      sites = [];
    }
  }
}
function saveSites() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(sites, null, 2));
}
loadSites();

// --- Vérification des sites ---
async function checkSite(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', timeout: 5000 });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Vérification des tokens bots ---
async function checkBotToken(tokenEncrypted) {
  try {
    const token = decrypt(tokenEncrypted);
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      timeout: 5000
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Mise à jour des statuts ---
async function updateStatuses() {
  for (const s of sites) {
    if (s.type === 'site') {
      s.status = (await checkSite(s.url)) ? 'up' : 'down';
    } else if (s.type === 'bot') {
      s.status = (await checkBotToken(s.token)) ? 'up' : 'down';
    } else {
      s.status = 'unknown';
    }
  }
  saveSites();
}

// Mise à jour toutes les 60 secondes
setInterval(updateStatuses, 60 * 1000);
updateStatuses();

// --- Discord Client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});
client.login(process.env.TOKEN).catch(console.error);

// --- Express routes ---

// Servir dashboard HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Liste des sites/bots avec status
app.get('/api/listesites', (req, res) => {
  const data = sites.map(s => ({
    name: s.name,
    type: s.type,
    status: s.status,
    url: s.url || undefined
  }));
  res.json(data);
});

// Ajouter un site ou bot
app.post('/api/add', (req, res) => {
  const { type, name, value } = req.body;
  if (!type || !name || !value) return res.json({ success: false, message: 'Champs manquants' });

  if (sites.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    return res.json({ success: false, message: 'Ce nom existe déjà.' });
  }

  if (type === 'site') {
    sites.push({ name, url: value, type, status: 'unknown' });
  } else if (type === 'bot') {
    sites.push({ name, token: encrypt(value), type, status: 'unknown' });
  } else {
    return res.json({ success: false, message: 'Type invalide.' });
  }
  saveSites();
  res.json({ success: true, message: `${name} ajouté.` });
});

// Supprimer un site ou bot
app.post('/api/remove', (req, res) => {
  const { name } = req.body;
  if (!name) return res.json({ success: false, message: 'Nom manquant.' });

  const index = sites.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
  if (index === -1) return res.json({ success: false, message: 'Service non trouvé.' });

  sites.splice(index, 1);
  saveSites();
  res.json({ success: true, message: `${name} supprimé.` });
});

// Mettre à jour url/token d’un service
app.post('/api/update', (req, res) => {
  const { name, newValue } = req.body;
  if (!name || !newValue) return res.json({ success: false, message: 'Champs manquants.' });

  const site = sites.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (!site) return res.json({ success: false, message: 'Service non trouvé.' });

  if (site.type === 'site') {
    site.url = newValue;
  } else if (site.type === 'bot') {
    site.token = encrypt(newValue);
  } else {
    return res.json({ success: false, message: 'Type inconnu.' });
  }
  saveSites();
  res.json({ success: true, message: `${name} mis à jour.` });
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🌐 Dashboard accessible sur http://localhost:${PORT}`);
});
