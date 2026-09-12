const { cmd } = require("../command");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const cookiesPath = path.resolve(__dirname, "../cookies/xnxx.txt");
const baseTempDir = path.resolve(__dirname, "../temp");

if (!fs.existsSync(baseTempDir)) fs.mkdirSync(baseTempDir, { recursive: true });

/* ================= SIGNATURE SOLVER ================= */
const SIGNATURE_ARGS = [
  "--remote-components", "ejs:github",
  "--js-runtimes", "node"
];

/* ================= BASIC HELPERS ================= */
function safeName(name, max = 60) {
  return String(name || "video")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(f => path.join(dir, f));
}

function findLargest(dir, ext) {
  const files = listFiles(dir).filter(f => f.endsWith(ext));
  if (!files.length) return null;
  return files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
}

function clearTemp(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, file));
    }
  } catch (e) {
    console.log("Temp clear error:", e.message);
  }
}

/* ================= URL HELPERS ================= */
function ensureHttp(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return "https://" + u;
}

function isSupportedXnxxUrl(u) {
  try {
    const host = new URL(ensureHttp(u)).hostname.toLowerCase();
    return host.includes("xnxx");
  } catch {
    return false;
  }
}

function normalizeXnxx(u) {
  try {
    const url = new URL(ensureHttp(u));
    url.hostname = "www.xnxx.com";
    return url.toString();
  } catch {
    return u;
  }
}

/* ================= YTDLP RUNNER ================= */
function runYtDlp(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      args,
      { cwd, windowsHide: true, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.output = (stderr || stdout || err.message || "").toString();
          return reject(err);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

/* ================= QUALITY PARSER ================= */
function parseQualityAndUrl(q) {
  let quality = 720;
  let url = (q || "").trim();

  const parts = url.split(" ");
  if (parts.length > 1 && /^\d+p?$/.test(parts[0])) {
    quality = parseInt(parts[0].replace("p", ""));
    url = parts.slice(1).join(" ");
  }

  return { quality, url };
}

/* ================= COMMAND ================= */
cmd(
  {
    pattern: "xnxx",
    alias: ["xnxx2", "xnxxdl"],
    ownerOnly: true,
    react: "🔞",
    desc: "XNXX Downloader",
    category: "download",
    filename: __filename,
  },
  async (bot, msg, m, { from, q, reply }) => {

    const workDir = baseTempDir;

    try {
      const { quality, url } = parseQualityAndUrl(q);

      if (!url) return reply("❌ Send video link");
      if (!isSupportedXnxxUrl(url)) return reply("❌ Invalid XNXX link");

      const finalUrl = normalizeXnxx(url);

      const outtmpl = path.join(workDir, "video_%(id)s.%(ext)s");
      const hasCookies = fs.existsSync(cookiesPath);

      /* ================= METADATA ================= */
      const metaArgs = [
        "--skip-download",
        "--write-thumbnail",
        "--convert-thumbnails", "jpg",
        "--write-info-json",
        ...SIGNATURE_ARGS,
        "-o", outtmpl
      ];

      if (hasCookies) metaArgs.push("--cookies", cookiesPath);
      metaArgs.push(finalUrl);

      await runYtDlp(metaArgs, workDir);

      const infoFile = listFiles(workDir).find(f => f.endsWith(".info.json"));
      if (!infoFile) throw new Error("Metadata failed");

      const info = JSON.parse(fs.readFileSync(infoFile));

      const title = info.title || "Video";
      const uploader = info.uploader || "Unknown";
      const duration = info.duration
        ? new Date(info.duration * 1000).toISOString().substring(11, 19)
        : "Unknown";
      const views = info.view_count
        ? Number(info.view_count).toLocaleString()
        : "Unknown";

      const thumb = listFiles(workDir).find(f => f.endsWith(".jpg"));

      const caption =
        `👻 GHOST XNXX DOWNLOADER\n\n` +
        `🎬 ${title}\n` +
        `👤 ${uploader}\n` +
        `⏳ ${duration}\n` +
        `👁 ${views}\n` +
        `🎥 ${quality}p\n\n` +
        `📥 Downloading...`;

      if (thumb) {
        await bot.sendMessage(
          from,
          { image: fs.readFileSync(thumb), caption },
          { quoted: msg }
        );
      } else {
        await reply(caption);
      }

      /* ================= DOWNLOAD ================= */
      const format = `b[height<=${quality}]/b`;

      const dlArgs = [
        "-f", format,
        "--no-playlist",
        "--no-warnings",
        "--fixup", "never",
        ...SIGNATURE_ARGS,
        "-o", outtmpl
      ];

      if (hasCookies) dlArgs.push("--cookies", cookiesPath);
      dlArgs.push(finalUrl);

      await runYtDlp(dlArgs, workDir);

      /* ================= FIND OUTPUT ================= */
      let video =
        findLargest(workDir, ".mp4") ||
        findLargest(workDir, ".mkv") ||
        findLargest(workDir, ".webm");

      if (!video) throw new Error("Download failed");

      const ext = path.extname(video).slice(1);

      /* ================= SEND FILE ================= */
      await bot.sendMessage(
        from,
        {
          document: fs.readFileSync(video),
          mimetype: ext === "mp4" ? "video/mp4" : "application/octet-stream",
          fileName: `${safeName(title)}_${quality}p.${ext}`
        },
        { quoted: msg }
      );

    } catch (e) {
      console.error(e);
      reply("❌ " + (e.message || "Download error"));
    } finally {
      /* ================= CLEAN TEMP ================= */
      clearTemp(workDir);
    }

  }
);
