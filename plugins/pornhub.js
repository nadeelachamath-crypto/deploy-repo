const { cmd } = require("../command");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const { isOwner } = require("../lib/auth");

const cookiesPath = path.resolve(__dirname, "../cookies/pornhubcookies.txt");
const tempDir = path.resolve(__dirname, "../temp");

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

function findFile(dir, ext) {
  const files = fs.readdirSync(dir);
  return files.find(f => f.endsWith(ext));
}

function safeName(name, max = 60) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .slice(0, max);
}

// Helper function to execute commands with buffer handling
function executeCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const process = execFile(command, args, {
      maxBuffer: 200 * 1024 * 1024,
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
    
    if (options.timeout) {
      setTimeout(() => {
        process.kill();
        reject(new Error('Process timeout'));
      }, options.timeout);
    }
  });
}

cmd(
  {
    pattern: "pornhub",
    alias: ["ph", "pornhubdl"],
    ownerOnly: true,
    react: "💦",
    desc: "Pornhub downloader (thumbnail first, then video) with quality selector",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    try {
      /* ---------- SAFE INPUT + QUALITY ---------- */
      let quality = 720; // default
      let query = typeof q === "string" ? q.trim() : "";

      const parts = query.split(/\s+/);
      if (parts.length > 1) {
        let first = parts[0].toLowerCase().replace("p", "");
        if (["360","480","720","1080"].includes(first)) {
          quality = parseInt(first);
          query = parts.slice(1).join(" "); // rest is URL
        }
      }

      if (!query) return reply("❌ Please send a Pornhub video link.");
      if (!query.includes("pornhub.com")) return reply("❌ Invalid Pornhub URL.");
      if (!fs.existsSync(cookiesPath)) return reply("⚠️ Pornhub cookies not found in /cookies.");

      const outputTemplate = path.join(tempDir, "pornhub_%(id)s.%(ext)s");

      /* ==================================================
         🔹 PHASE 1: METADATA + THUMBNAIL (NO VIDEO)
         ================================================== */
      const metaArgs = [
        "--skip-download",
        "--no-warnings",
        "--cookies", cookiesPath,
        "--ffmpeg-location", ffmpegPath,
        "--write-thumbnail",
        "--convert-thumbnails", "jpg",
        "--write-info-json",
        "-o", outputTemplate,
        query
      ];

      await executeCommand("yt-dlp", metaArgs, { timeout: 30000 });

      // Find the generated files
      const infoFile = findFile(tempDir, ".info.json");
      const thumbFile = findFile(tempDir, ".jpg");

      if (!infoFile) throw new Error("Failed to fetch metadata.");

      const infoPath = path.join(tempDir, infoFile);
      const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));

      const title = info.title || "Pornhub Video";
      const duration = info.duration ? new Date(info.duration * 1000).toISOString().substr(11, 8) : "Unknown";
      const views = info.view_count ? info.view_count.toLocaleString() : "Unknown";
      const stars = Array.isArray(info.cast) && info.cast.length ? info.cast.join(", ") : "Unknown";

      const selectedQuality = info.height ? `${Math.min(info.height, quality)}p` : `${quality}p`;

      // Send thumbnail message first
      if (thumbFile) {
        const thumbPath = path.join(tempDir, thumbFile);
        await robin.sendMessage(
          from,
          {
            image: { url: thumbPath }, // Send as image file path
            caption: 
              `👻 *GHOST PORNHUB DOWNLOADER*\n\n` +
              `🎥 *Title:* ${title}\n` +
              `⭐ *Stars:* ${stars}\n` +
              `🕒 *Duration:* ${duration}\n` +
              `👁 *Views:* ${views}\n` +
              `📦 *Quality:* ${selectedQuality}\n` +
              `🔗 *URL:* ${query}\n\n` +
              `📥 *Downloading video…*`,
          },
          { quoted: mek }
        );
      } else {
        // Send text message if thumbnail not found
        await robin.sendMessage(
          from,
          {
            text: 
              `👻 *GHOST PORNHUB DOWNLOADER*\n\n` +
              `🎥 *Title:* ${title}\n` +
              `⭐ *Stars:* ${stars}\n` +
              `🕒 *Duration:* ${duration}\n` +
              `👁 *Views:* ${views}\n` +
              `📦 *Quality:* ${selectedQuality}\n` +
              `🔗 *URL:* ${query}\n\n` +
              `📥 *Downloading video…*`,
          },
          { quoted: mek }
        );
      }

      /* ==================================================
         🔹 PHASE 2: VIDEO DOWNLOAD
         ================================================== */
      const videoArgs = [
        "--no-warnings",
        "--cookies", cookiesPath,
        "--ffmpeg-location", ffmpegPath,
        "-f", `bv*[height<=${quality}]+ba/best[height<=${quality}]/best`,
        "--merge-output-format", "mp4",
        "--concurrent-fragments", "16",
        "--downloader", "aria2c",
        "--downloader-args", "aria2c:-x 8 -s 8 -k 1M",
        "-o", outputTemplate,
        query
      ];

      await executeCommand("yt-dlp", videoArgs, { timeout: 180000 });

      const videoFile = findFile(tempDir, ".mp4");
      if (!videoFile) throw new Error("Video download failed.");

      const videoPath = path.join(tempDir, videoFile);

      // Check file size before sending
      const stats = fs.statSync(videoPath);
      if (stats.size > 1000 * 1024 * 1024) {
        fs.unlinkSync(videoPath);
        throw new Error("Video file too large (over 100MB)");
      }

      // Send video file
      await robin.sendMessage(
        from,
        {
          document: { url: videoPath },
          mimetype: "video/mp4",
          fileName: `${safeName(title)}_${selectedQuality}.mp4`,
        },
        { quoted: mek }
      );

      /* ---------- CLEANUP ---------- */
      fs.readdirSync(tempDir).forEach(f => {
        if (f.startsWith("pornhub_")) {
          try {
            fs.unlinkSync(path.join(tempDir, f));
          } catch (cleanupErr) {
            console.log("Cleanup error:", cleanupErr.message);
          }
        }
      });

    } catch (err) {
      console.error("Pornhub Error:", err);
      
      // Cleanup on error
      try {
        fs.readdirSync(tempDir).forEach(f => {
          if (f.startsWith("pornhub_")) {
            try {
              fs.unlinkSync(path.join(tempDir, f));
            } catch (e) {}
          }
        });
      } catch (cleanupErr) {}
      
      reply(`❌ Error: ${err.message || "Unknown error"}`);
    }
  }
);
