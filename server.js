const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app       = express();
const PORT      = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ADMIN_PASS = 'Johnny1';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1); // needed on Render (sits behind proxy)

// ─── JSON HELPERS ─────────────────────────────────────────────────────
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { questions: [], submissions: [], submittedIPs: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─── ADMIN AUTH MIDDLEWARE ─────────────────────────────────────────────
function adminOnly(req, res, next) {
  if (req.headers['x-admin-pass'] !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── LAITH DETECTION ──────────────────────────────────────────────────
// Catches: Laith, laith, LAITH, La1th, La!th, L@ith, |aith, L4ith, etc.
function isBlocked(name) {
  const n = name.toLowerCase().replace(/\s+/g, '');

  // Normalise common leetspeak → latin, two passes (1 can mean l or i)
  const passL = n
    .replace(/[@4]/g, 'a')
    .replace(/[1!|]/g, 'l')   // treat 1/!/| as l
    .replace(/\+/g, 't')
    .replace(/#/g, 'h');

  const passI = n
    .replace(/[@4]/g, 'a')
    .replace(/[1!]/g, 'i')    // treat 1/! as i
    .replace(/\+/g, 't')
    .replace(/#/g, 'h');

  return passL.includes('laith') || passI.includes('laith');
}

// ─── IP HELPER ────────────────────────────────────────────────────────
function getIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

// ══════════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ══════════════════════════════════════════════════════════════════════

// Applicant list — name + status only (no private data)
app.get('/api/list', (req, res) => {
  const { submissions } = readData();
  res.json(submissions.map(s => ({ id: s.id, name: s.name, status: s.status })));
});

// Questions — for rendering the public form
app.get('/api/questions', (req, res) => {
  const { questions } = readData();
  res.json(questions);
});

// Submit application
app.post('/api/submit', (req, res) => {
  const ip   = getIP(req);
  const data = readData();

  // Rate limit: one submission per IP
  if (data.submittedIPs.includes(ip)) {
    return res.status(429).json({ error: "You've already submitted an application." });
  }

  const { name, from, answers } = req.body;

  if (!name || !from) {
    return res.status(400).json({ error: 'Name and location are required.' });
  }

  // Block Laith in any variation
  if (isBlocked(name)) {
    return res.status(403).json({ error: 'Unable to process your application.' });
  }

  const submission = {
    id:      Date.now().toString(),
    name:    name.trim(),
    from:    from.trim(),
    answers: answers || {},
    status:  'pending',
    at:      new Date().toISOString(),
  };

  data.submissions.push(submission);
  data.submittedIPs.push(ip);
  writeData(data);

  res.json({ success: true, id: submission.id });
});

// ══════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES — all require x-admin-pass: Johnny1 header
// ══════════════════════════════════════════════════════════════════════

// Full submission list (includes answers, from, timestamps)
app.get('/api/admin/submissions', adminOnly, (req, res) => {
  const { submissions } = readData();
  res.json(submissions);
});

// Update submission status (approved / declined / pending)
app.post('/api/admin/submissions/:id/status', adminOnly, (req, res) => {
  const data = readData();
  const sub  = data.submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });

  const { status } = req.body;
  if (!['approved', 'declined', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  sub.status = status;
  writeData(data);
  res.json({ success: true });
});

// Get questions (admin view)
app.get('/api/admin/questions', adminOnly, (req, res) => {
  const { questions } = readData();
  res.json(questions);
});

// Add question
app.post('/api/admin/questions', adminOnly, (req, res) => {
  const data = readData();
  const { text, type, req: required, opts } = req.body;

  if (!text) return res.status(400).json({ error: 'Question text required.' });

  const q = {
    id:   Date.now().toString(),
    text: text.trim(),
    type: type || 'text',
    req:  required || 'yes',
    opts: opts || [],
  };

  data.questions.push(q);
  writeData(data);
  res.json(q);
});

// Edit question
app.put('/api/admin/questions/:id', adminOnly, (req, res) => {
  const data = readData();
  const q    = data.questions.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found.' });

  const { text, type, req: required, opts } = req.body;
  if (text)     q.text = text.trim();
  if (type)     q.type = type;
  if (required) q.req  = required;
  q.opts = opts || [];

  writeData(data);
  res.json(q);
});

// Delete question
app.delete('/api/admin/questions/:id', adminOnly, (req, res) => {
  const data = readData();
  data.questions = data.questions.filter(q => q.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Trap House running on port ${PORT}`);
});
