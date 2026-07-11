const { cmd } = require("../command");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { downloadContentFromMessage, getContentType } = require("@whiskeysockets/baileys");
const { OWNER_NUM } = require("../config"); // your owner numbers array

// ================== HELPERS ==================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isRateOverlimit(err) {
  const msg = String(err?.message || "");
  return (
    msg.includes("rate-overlimit") ||
    err?.data === 429 ||
    err?.status === 429 ||
    err?.output?.statusCode === 429 ||
    err?.output?.payload?.statusCode === 429
  );
}

function extFromMime(mime, fallback = ".bin") {
  const m = String(mime || "").toLowerCase();
  if (m.includes("image/jpeg")) return ".jpg";
  if (m.includes("image/png")) return ".png";
  if (m.includes("image/webp")) return ".webp";
  if (m.includes("video/mp4")) return ".mp4";
  if (m.includes("video/quicktime")) return ".mov";
  if (m.includes("audio/mpeg")) return ".mp3";
  if (m.includes("audio/ogg")) return ".ogg";
  if (m.includes("audio/mp4")) return ".m4a";
  if (m.includes("application/pdf")) return ".pdf";
  return fallback;
}

// ================== MESSAGE HELPERS ==================
function unwrapMessage(msg) {
  let root = msg;
  if (!root || typeof root !== "object") return { root: null, type: null };
  let type = getContentType(root);
  if (!type) return { root: null, type: null };

  while (type === "ephemeralMessage" || (type && type.startsWith("viewOnceMessage"))) {
    root = root?.[type]?.message || null;
    if (!root) return { root: null, type: null };
    type = getContentType(root);
  }

  while (type && type.includes("WithCaptionMessage") && root?.[type]?.message) {
    root = root[type].message;
    type = getContentType(root);
  }

  return { root, type };
}

function findContextInfo(messageObj) {
  if (!messageObj || typeof messageObj !== "object") return null;
  for (const k of Object.keys(messageObj)) {
    const v = messageObj[k];
    if (v && typeof v === "object" && v.contextInfo) return v.contextInfo;
  }
  return null;
}

function getQuotedFromMek(mek) {
  const raw = mek?.message;
  if (!raw) return null;
  const { root, type } = unwrapMessage(raw);
  if (!root || !type) return null;

  let ctx = root[type]?.contextInfo || findContextInfo(root);
  const quoted = ctx?.quotedMessage;
  if (!quoted) return null;

  const { root: qRoot, type: qType } = unwrapMessage(quoted);
  if (!qRoot || !qType) return null;

  const qContent = qRoot[qType];
  if (!qContent) return null;

  return { qType, qContent };
}

async function downloadToFile(msgContent, dlType, outPath) {
  const stream = await downloadContentFromMessage(msgContent, dlType);
  const ws = fs.createWriteStream(outPath);
  try {
    for await (const chunk of stream) ws.write(chunk);
    await new Promise((resolve, reject) => {
      ws.end(resolve);
      ws.on("error", reject);
    });
  } catch (e) {
    try { ws.close(); } catch {}
    throw e;
  }
}

// ================== PULSE ANIMATION ==================
function makePulseFrames() {
  return ["▱▱▱▱▱","▰▱▱▱▱","▰▰▱▱▱","▰▰▰▱▱","▰▰▰▰▱","▰▰▰▰▰","▰▰▰▰▱","▰▰▰▱▱","▰▰▱▱▱","▰▱▱▱▱"];
}

async function startPulseEdit(sock, jid, sendOpts = {}, opts = {}) {
  const intervalMs = opts.intervalMs ?? 1500;
  const maxMs = opts.maxMs ?? 60_000;
  const maxEdits = opts.maxEdits ?? 20;
  let stage = opts.stage || "Downloading";
  let note = opts.note || "Saving media";
  const frames = makePulseFrames();
  let idx = 0, edits = 0, stopped = false, editing = false;

  const render = () => `👻 *GHOST*\n*${stage}* ${frames[idx % frames.length]}\n_${note}_`;

  const sent = await sock.sendMessage(jid, { text: render() }, sendOpts);

  async function safeEdit(text) {
    if (editing) return false;
    editing = true;
    try {
      await sock.sendMessage(jid, { text, edit: sent.key }, sendOpts);
      return true;
    } catch {
      return false;
    } finally { editing = false; }
  }

  const timer = setInterval(async () => {
    if (stopped) return;
    if (edits >= maxEdits || Date.now() - sent.messageTimestamp*1000 > maxMs) {
      stopped = true;
      clearInterval(timer);
      return;
    }
    idx = (idx + 1) % frames.length;
    edits++;
    const ok = await safeEdit(render());
    if (!ok) { stopped = true; clearInterval(timer); }
  }, intervalMs);

  return {
    key: sent.key,
    async setStage(newStage, newNote) {
      stage = newStage || stage;
      if (typeof newNote === "string") note = newNote;
      idx = 0;
      await safeEdit(render());
    },
    async stop(finalText) {
      stopped = true;
      clearInterval(timer);
      await sleep(intervalMs + 150);
      if (finalText) for (let t=0; t<3; t++) { const ok = await safeEdit(finalText); if (ok) break; await sleep(1200); }
    }
  };
}

// ================== COMMAND ==================
cmd({
  pattern: "save",
  react: "💾",
  desc: "Save replied media and forward to owner",
  category: "utility",
  filename: __filename
}, async (robin, mek, m, { from, reply }) => {
  let tempFile = null;
  let anim = null;

  const isGroup = String(from || "").endsWith("@g.us");

  try {
    const q = getQuotedFromMek(mek);
    if (!q) return reply("📌 Reply to an image, video, audio, sticker, or document to save it.");
    const { qType, qContent } = q;

    let dlType = null;
    if (qType === "imageMessage") dlType = "image";
    else if (qType === "videoMessage" || qType === "ptvMessage") dlType = "video";
    else if (qType === "audioMessage") dlType = "audio";
    else if (qType === "stickerMessage") dlType = "sticker";
    else if (qType === "documentMessage") dlType = "document";

    if (!dlType) return reply("❌ Unsupported media type.");

    const mime = qContent.mimetype || "application/octet-stream";

    let ext = ".bin";
    let fileName = `Saved_${Date.now()}`;

    if (qType === "documentMessage") {
      const original = qContent.fileName || "";
      ext = original ? path.extname(original) : extFromMime(mime, ".bin");
      fileName = original ? original : `${fileName}${ext}`;
    } else {
      ext = extFromMime(mime, qType === "imageMessage" ? ".jpg" : qType.includes("video") ? ".mp4" : qType === "audioMessage" ? ".mp3" : qType === "stickerMessage" ? ".webp" : ".bin");
      fileName = `${fileName}${ext}`;
    }

    tempFile = path.join(os.tmpdir(), `ghost_save_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);

    anim = await startPulseEdit(robin, from, { quoted: mek }, {
      stage: "Downloading",
      note: isGroup ? "Please wait…" : "Saving media",
      intervalMs: isGroup ? 3000 : 900,
      maxEdits: isGroup ? 12 : 40
    });

    await downloadToFile(qContent, dlType, tempFile);

    await anim.setStage("Forwarding", "Sending to owner…");

    // Forward to owners
    if (OWNER_NUM && Array.isArray(OWNER_NUM)) {
      for (let owner of OWNER_NUM) {
        if (!owner.endsWith("@s.whatsapp.net")) owner = owner.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
        await robin.sendMessage(owner, {
          document: fs.readFileSync(tempFile),
          mimetype: mime,
          fileName,
          caption: `👻 *New Media Received*\nFrom: ${from}\nFile: ${fileName}`
        });
      }
    }

    await anim.stop("✅ Sent to owner successfully!");

  } catch (e) {
    console.error("❌ Save command error:", e);
    try { if (anim) await anim.stop("❌ Failed to save media."); } catch {}
    return reply(`❌ Error: ${e.message || "Something went wrong."}`);
  } finally {
    if (tempFile) {
      try { await sleep(800); await fs.unlink(tempFile); } catch {}
    }
  }
});
