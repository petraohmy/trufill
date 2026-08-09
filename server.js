// Trufill — backend, Supabase-backed version.
//
// Auth: the frontend signs the user in directly with Supabase (magic link
// email) and sends the resulting access token on every request. This
// server verifies that token per-request and makes all database/storage
// calls AS that user, so Postgres Row Level Security (see schema.sql) is
// the thing actually enforcing "your memory is yours" — not application
// code that could have a bug in it.
//
// Scope, same as before: single fillable PDF, exact-name field matching
// (semantic/AI matching is a later sprint, once the field taxonomy from
// the bank-form audit is far enough along to seed it).

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const { PDFDocument } = require("pdf-lib");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY — copy .env.example to .env and fill them in from your Supabase project's Settings -> API page.");
  process.exit(1);
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.static("public"));

// Build a Supabase client scoped to the calling user's own access token,
// so every query below runs under their identity and RLS applies.
function clientForRequest(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function requireAuth(req, res, next) {
  const supabase = clientForRequest(req);
  if (!supabase) return res.status(401).json({ error: "Not signed in." });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return res.status(401).json({ error: "Not signed in." });
  req.supabase = supabase;
  req.userId = data.user.id;
  next();
}

async function loadProfile(supabase, userId) {
  const { data, error } = await supabase.from("profiles").select("data").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? data.data : {};
}

async function saveProfile(supabase, userId, profileData) {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, data: profileData, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// --- 1. Upload a form, extract its fields, match against memory ---------
app.post("/api/upload", requireAuth, upload.single("pdf"), async (req, res) => {
  try {
    const pdfDoc = await PDFDocument.load(req.file.buffer);
    const fields = pdfDoc.getForm().getFields();

    if (fields.length === 0) {
      return res.status(422).json({
        fillable: false,
        message: "This PDF has no fillable fields — it's likely scanned or flattened. " +
                 "That's exactly the risk the fillability audit is meant to catch.",
      });
    }

    const memory = await loadProfile(req.supabase, req.userId);
    const fieldReport = fields.map((f) => {
      const name = f.getName();
      return {
        name,
        type: f.constructor.name,
        knownValue: Object.prototype.hasOwnProperty.call(memory, name) ? memory[name] : null,
      };
    });

    // Stash the raw PDF in Supabase Storage, under this user's own folder,
    // so /api/fill can reload the exact same document. Storage policies
    // (schema.sql) mean one user's files are physically inaccessible to another.
    const uploadId = Date.now().toString(36);
    const storagePath = `${req.userId}/${uploadId}.pdf`;
    const { error: uploadErr } = await req.supabase.storage
      .from("uploads")
      .upload(storagePath, req.file.buffer, { contentType: "application/pdf" });
    if (uploadErr) throw uploadErr;

    res.json({ fillable: true, uploadId, fields: fieldReport });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Could not read this PDF: " + err.message });
  }
});

// --- 2. Fill the form with (memory + newly provided) values --------------
app.post("/api/fill", requireAuth, async (req, res) => {
  try {
    const { uploadId, values } = req.body;
    const storagePath = `${req.userId}/${uploadId}.pdf`;

    const { data: fileData, error: downloadErr } = await req.supabase.storage
      .from("uploads")
      .download(storagePath);
    if (downloadErr) return res.status(404).json({ error: "Upload expired, please re-upload the form." });

    const pdfDoc = await PDFDocument.load(await fileData.arrayBuffer());
    const form = pdfDoc.getForm();
    const memory = await loadProfile(req.supabase, req.userId);

    for (const [name, value] of Object.entries(values || {})) {
      try {
        form.getTextField(name).setText(String(value));
      } catch {
        continue; // non-text field types (checkboxes, signatures) — later sprint
      }
      memory[name] = value; // remember anything new — the whole product, one line
    }
    await saveProfile(req.supabase, req.userId, memory);

    form.flatten();
    const filledBytes = await pdfDoc.save();

    await req.supabase.storage.from("uploads").remove([storagePath]);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="completed-form.pdf"');
    res.send(Buffer.from(filledBytes));
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Could not fill this PDF: " + err.message });
  }
});

app.get("/api/memory", requireAuth, async (req, res) => {
  res.json(await loadProfile(req.supabase, req.userId));
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => console.log(`Trufill backend running on :${PORT}`));
