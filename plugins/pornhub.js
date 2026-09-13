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
        reject(new Error(stderr || error.message));
      } else {
        resolve({ stdout, stderr });
      }
    });

    if (options.timeout) {
      setTimeout(() => {
        process.kill();
        reject(new Error("Process timeout"));
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
      let quality = 720; // default
      let query = typeof q === "string" ? q.trim() : "";

      const parts = query.split(/\s+/);
      if (parts.length > 1) {
        let first = parts[0].toLowerCase().replace("p", "");
        if (["360", "480", "720", "1080"].includes(first)) {
          quality = parseInt(first);
          query = parts.slice(1).join(" "); // rest is URL
        }
      }

      if (!query) return reply("❌ Please send a Pornhub video link.");
      if (!query.includes("pornhub.com")) return reply("❌ Invalid Pornhub URL.");
      if (!fs.existsSync(cookiesPath)) return reply("⚠️ Pornhub cookies not found in /cookies.");

      const outputTemplate = path.join(tempDir, "pornhub_%(id)s.%(ext)s");

      // Phase 1: Metadata
      const metaArgs = [
        "--skip-download",
        "--no-warnings",
        "--cookies", cookiesPath,
        "--impersonate", "chrome",
        "--ffmpeg-location", ffmpegPath,
        "--write-thumbnail",
        "--convert-thumbnails", "jpg",
        "--write-info-json",
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "--referer", "https://www.pornhub.com/",
        "--geo-bypass",
        "-o", outputTemplate,
        query
      ];

      let metaResult;
      try {
        metaResult = await executeCommand("yt-dlp", metaArgs, { timeout: 30000 });
      } catch (err) {
        if (err.message.includes("HTTP Error 410")) {
          return reply("🚫 Pornhub currently blocks automated downloads (HTTP 410 Gone). Downloader unsupported.");
        }
        return reply(`❌ Metadata fetch failed: ${err.message}`);
      }

      const infoFile = findFile(tempDir, ".info.json");
      const thumbFile = findFile(tempDir, ".jpg");

      if (!infoFile) return reply("❌ Failed to fetch metadata.");

      const infoPath = path.join(tempDir, infoFile);
      const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));

      const title = info.title || "Pornhub Video";
      const duration = info.duration ? new Date(info.duration * 1000).toISOString().substr(11, 8) : "Unknown";
      const views = info.view_count ? info.view_count.toLocaleString() : "Unknown";
      const stars = Array.isArray(info.cast) && info.cast.length ? info.cast.join(", ") : "Unknown";
      const selectedQuality = info.height ? `${Math.min(info.height, quality)}p` : `${quality}p`;

      // Send thumbnail or text
      const caption = 
        `👻 *GHOST PORNHUB DOWNLOADER*\n\n` +
        `🎥 *Title:* ${title}\n` +
        `⭐ *Stars:* ${stars}\n` +
        `🕒 *Duration:* ${duration}\n` +
        `👁 *Views:* ${views}\n` +
        `📦 *Quality:* ${selectedQuality}\n` +
        `🔗 *URL:* ${query}\n\n` +
        `📥 *Downloading video…*`;

      if (thumbFile) {
        const thumbPath = path.join(tempDir, thumbFile);
        await robin.sendMessage(from, { image: { url: thumbPath }, caption }, { quoted: mek });
      } else {
        await robin.sendMessage(from, { text: caption }, { quoted: mek });
      }

      // Phase 2: Video download
      const videoArgs = [
        "--no-warnings",
        "--concurrent-fragments", "20",
        "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--cookies", cookiesPath,
        "--impersonate", "chrome",
        "--ffmpeg-location", ffmpegPath,
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "--referer", "https://www.pornhub.com/",
        "--geo-bypass",
        "-o", outputTemplate,
        query
      ];

      try {
        await executeCommand("yt-dlp", videoArgs, { timeout: 900000 });
      } catch (err) {
        if (err.message.includes("HTTP Error 410")) {
          return reply("🚫 Pornhub video download blocked (HTTP 410 Gone). Downloader unsupported.");
        }
        return reply(`❌ Video download failed: ${err.message}`);
      }

      // Find the downloaded video file
      const filesAfterDownload = fs.readdirSync(tempDir);
      const videoFile = filesAfterDownload.find(f => f.startsWith("pornhub_") &&
        [".mp4", ".mkv", ".webm"].some(ext => f.endsWith(ext)));

      if (!videoFile) {
        return reply("❌ Video was downloaded but the file could not be located in temp.");
      }

      const videoPath = path.join(tempDir, videoFile);
      const stats = fs.statSync(videoPath);
      const fileSizeMB = stats.size / (1024 * 1024);

      try {
        // Try sending as a video ONLY if it's very small (under 16MB)
        if (fileSizeMB < 16) {
          await robin.sendMessage(
            from,
            {
              video: { url: videoPath },
              caption:
                `🎉 *GHOST PORNHUB DOWNLOADER*\n\n` +
                `🎥 *Title:* ${title}\n` +
                `⭐ *Stars:* ${stars}\n` +
                `🕒 *Duration:* ${duration}\n` +
                `👁 *Views:* ${views}\n` +
                `📦 *Quality:* ${selectedQuality}\n` +
                `🔗 *URL:* ${query}\n\n` +
                `✅ *Video successfully downloaded and sent!*`,
            },
            { quoted: mek }
          );
        } else {
          // Force large files directly to document mode to avoid upload failures
          throw new Error("File too large for video upload");
        }
      } catch (uploadErr) {
        // Final Fallback: Send as a document (supports up to 2GB)
        await robin.sendMessage(
          from,
          {
            document: { url: videoPath },
            mimetype: "video/mp4",
            fileName: `${safeName(title)}.mp4`,
            caption:
              `🎉 *GHOST PORNHUB DOWNLOADER*\n\n` +
              `🎥 *Title:* ${title}\n` +
              `📦 *Package send successfully.*`,
          },
          { quoted: mek }
        );
      }

      // Thorough Clean up: Delete everything in tempDir
      const allFiles = fs.readdirSync(tempDir);
      allFiles.forEach(file => {
        try {
          fs.unlinkSync(path.join(tempDir, file));
        } catch (e) {
          // Ignore errors during cleanup
        }
      });
    } catch (error) {
      await reply(`Error: ${error.message}`);
    }
  }
);
