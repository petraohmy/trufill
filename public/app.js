// Fill these in with your own Supabase project's values —
// Dashboard -> Project Settings -> API. The anon key is safe to expose in
// frontend code by design; it only grants what your RLS policies allow.
const SUPABASE_URL = "https://your-project-ref.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-public-key";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUploadId = null;
let currentFields = [];
let session = null;

const loginPanel = document.getElementById("login-panel");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const sessionEmail = document.getElementById("session-email");

document.getElementById("google-btn").addEventListener("click", () => {
  supabaseClient.auth.signInWithOAuth({ provider: "google" });
});
document.getElementById("apple-btn").addEventListener("click", () => {
  supabaseClient.auth.signInWithOAuth({ provider: "apple" });
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email-input").value;
  const { error } = await supabaseClient.auth.signInWithOtp({ email });
  loginStatus.textContent = error ? error.message : "Check your email for a sign-in link.";
});

document.getElementById("sign-out").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabaseClient.auth.signOut();
  location.reload();
});

supabaseClient.auth.onAuthStateChange((_event, newSession) => {
  session = newSession;
  if (session) showSignedIn();
});

async function showSignedIn() {
  loginPanel.classList.add("hidden");
  document.getElementById("upload-panel").classList.remove("hidden");
  sessionEmail.textContent = session.user.email;
}

function authHeaders(extra = {}) {
  return Object.assign({ Authorization: "Bearer " + session.access_token }, extra);
}

// Restore an existing session on page load (e.g. after a refresh).
supabaseClient.auth.getSession().then(({ data }) => {
  if (data.session) { session = data.session; showSignedIn(); }
});

const uploadForm = document.getElementById("upload-form");
const uploadError = document.getElementById("upload-error");
const uploadPanel = document.getElementById("upload-panel");
const fieldsPanel = document.getElementById("fields-panel");
const fieldsList = document.getElementById("fields-list");
const fillBtn = document.getElementById("fill-btn");
const progressLabel = document.getElementById("progress-label");
const progressFill = document.getElementById("progress-fill");

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadError.textContent = "";
  const file = document.getElementById("pdf-input").files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("pdf", file);

  const res = await fetch("/api/upload", { method: "POST", headers: authHeaders(), body: formData });
  const data = await res.json();

  if (!res.ok || data.fillable === false) {
    uploadError.textContent = data.message || data.error || "Upload failed.";
    return;
  }

  currentUploadId = data.uploadId;
  currentFields = data.fields;
  renderFields();
  uploadPanel.classList.add("hidden");
  fieldsPanel.classList.remove("hidden");
});

function renderFields() {
  fieldsList.innerHTML = "";
  currentFields.forEach((field) => {
    const block = document.createElement("div");
    block.className = "field-block";

    const label = document.createElement("p");
    label.className = "field-label";
    label.textContent = prettyLabel(field.name);
    block.appendChild(label);

    const input = document.createElement("input");
    input.className = "field-input" + (field.knownValue ? " known" : "");
    input.dataset.fieldName = field.name;
    input.value = field.knownValue || "";
    input.placeholder = field.knownValue ? "" : "Not on file yet — type it in";
    input.addEventListener("input", updateProgress);
    block.appendChild(input);

    if (field.knownValue) {
      const note = document.createElement("p");
      note.className = "known-note";
      note.textContent = "\u2728 filled from memory — edit if anything's changed";
      block.appendChild(note);
    }

    fieldsList.appendChild(block);
  });
  updateProgress();
}

function prettyLabel(name) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function updateProgress() {
  const inputs = fieldsList.querySelectorAll(".field-input");
  const done = Array.from(inputs).filter((i) => i.value.trim().length > 0).length;
  progressLabel.textContent = `${done} of ${inputs.length} done`;
  progressFill.style.width = `${(done / inputs.length) * 100}%`;
}

fillBtn.addEventListener("click", async () => {
  const inputs = fieldsList.querySelectorAll(".field-input");
  const values = {};
  inputs.forEach((i) => { values[i.dataset.fieldName] = i.value; });

  const res = await fetch("/api/fill", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ uploadId: currentUploadId, values }),
  });

  if (!res.ok) {
    const data = await res.json();
    alert(data.error || "Could not complete the form.");
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "completed-form.pdf";
  a.click();
});
