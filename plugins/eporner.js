const { cmd } = require("../command");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const { isOwner } = require("../lib/auth");

const cookiesPath = path.resolve(__dirname, "../cookies/eporner.txt");
const tempDir = path.resolve(__dirname, "../temp");

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

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
    pattern: "eporner",
    alias: ["ep", "epdl"],
    ownerOnly: true,
    react: "🔞",
    desc: "Eporner downloader (thumbnail first, then video) with quality selector",
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
        if (["360","480","720","1080","1440","2160"].includes(first)) {
          quality = parseInt(first);
          query = parts.slice(1).join(" "); // rest is URL
        }
      }

      if (!query) return reply("❌ Please send an Eporner video link.");
      if (!query.includes("eporner.com")) return reply("❌ Invalid Eporner URL.");

      // Extract video ID for file naming
      const videoId = query.split('/').pop() || `eporner_${Date.now()}`;
      const baseName = `ep_${videoId}`;
      const outputTemplate = path.join(tempDir, `${baseName}.%(ext)s`);
      
      /* ==================================================
         🔹 PHASE 1: GET INFO ONLY (NO DOWNLOAD)
         ================================================== */
      const infoArgs = [
        "--dump-json",
        "--no-warnings",
        "--no-check-certificate",
        query
      ];

      if (fs.existsSync(cookiesPath)) {
        infoArgs.splice(1, 0, "--cookies", cookiesPath);
      }

      const infoResult = await executeCommand("yt-dlp", infoArgs, { timeout: 30000 });
      const info = JSON.parse(infoResult.stdout);

      if (!info || !info.title) {
        throw new Error("Failed to fetch video information");
      }

      const title = info.title || "Eporner Video";
      const duration = info.duration ? new Date(info.duration * 1000).toISOString().substr(11, 8) : "Unknown";
      const views = info.view_count ? info.view_count.toLocaleString() : "Unknown";
      const uploader = info.uploader || "Unknown";
      const rating = info.average_rating ? `${info.average_rating}/5` : "Unknown";
      const categories = Array.isArray(info.categories) ? info.categories.join(", ") : "Unknown";
      const tags = Array.isArray(info.tags) ? info.tags.join(", ") : "None";
      const thumbnail_url = info.thumbnail || info.thumbnails?.[0]?.url;

      // Determine best available quality
      const availableQualities = info.formats?.map(f => f.height).filter(h => h) || [];
      const maxAvailable = Math.max(...availableQualities, 720);
      const selectedQuality = Math.min(maxAvailable, quality);

      /* ==================================================
         🔹 PHASE 2: THUMBNAIL + INFO DISPLAY
         ================================================== */
      if (thumbnail_url) {
        try {
          await robin.sendMessage(
            from,
            {
              image: { url: thumbnail_url },
              caption: 
                `🔞 *EPORNER DOWNLOADER*\n\n` +
                `🎥 *Title:* ${title}\n` +
                `👤 *Uploader:* ${uploader}\n` +
                `⭐ *Rating:* ${rating}\n` +
                `🏷️ *Categories:* ${categories}\n` +
                `📌 *Tags:* ${tags}\n` +
                `🕒 *Duration:* ${duration}\n` +
                `👁 *Views:* ${views}\n` +
                `📦 *Quality:* ${selectedQuality}p\n` +
                `🎯 *Available:* ${[...new Set(availableQualities)].sort((a,b)=>b-a).join(', ')}p\n` +
                `🔗 *URL:* ${query}\n\n` +
                `📥 *Downloading video…*`,
            },
            { quoted: mek }
          );
        } catch (thumbErr) {
          // Fallback to text if thumbnail fails
          await robin.sendMessage(
            from,
            {
              text: 
                `🔞 *EPORNER DOWNLOADER*\n\n` +
                `🎥 *Title:* ${title}\n` +
                `👤 *Uploader:* ${uploader}\n` +
                `⭐ *Rating:* ${rating}\n` +
                `🏷️ *Categories:* ${categories}\n` +
                `📌 *Tags:* ${tags}\n` +
                `🕒 *Duration:* ${duration}\n` +
                `👁 *Views:* ${views}\n` +
                `📦 *Quality:* ${selectedQuality}p\n` +
                `🎯 *Available:* ${[...new Set(availableQualities)].sort((a,b)=>b-a).join(', ')}p\n` +
                `🔗 *URL:* ${query}\n\n` +
                `📥 *Downloading video…*`,
            },
            { quoted: mek }
          );
        }
      } else {
        await robin.sendMessage(
          from,
          {
            text: 
              `🔞 *EPORNER DOWNLOADER*\n\n` +
              `🎥 *Title:* ${title}\n` +
              `👤 *Uploader:* ${uploader}\n` +
              `⭐ *Rating:* ${rating}\n` +
              `🏷️ *Categories:* ${categories}\n` +
              `📌 *Tags:* ${tags}\n` +
              `🕒 *Duration:* ${duration}\n` +
              `👁 *Views:* ${views}\n` +
              `📦 *Quality:* ${selectedQuality}p\n` +
              `🎯 *Available:* ${[...new Set(availableQualities)].sort((a,b)=>b-a).join(', ')}p\n` +
              `🔗 *URL:* ${query}\n\n` +
              `📥 *Downloading video…*`,
          },
          { quoted: mek }
        );
      }

      /* ==================================================
         🔹 PHASE 3: VIDEO DOWNLOAD WITH ENHANCED SETTINGS
         ================================================== */
      const videoArgs = [
        "--no-warnings",
        "--no-check-certificate",
        "--cookies", cookiesPath,
        "--ffmpeg-location", ffmpegPath,
        "-f", `bestvideo[height<=${selectedQuality}]+bestaudio/best[height<=${selectedQuality}]`,
        "--merge-output-format", "mp4",
        "--concurrent-fragments", "16",
        "--downloader", "aria2c",
        "--downloader-args", "aria2c:-x 8 -s 8 -k 1M",
        "--retries", "10",
        "--fragment-retries", "10",
        "--file-access-retries", "5",
        "--socket-timeout", "30",
        "--source-address", "0.0.0.0",
        "-o", outputTemplate,
        query
      ];

      // Only add cookies if file exists
      if (!fs.existsSync(cookiesPath)) {
        videoArgs.splice(3, 2); // Remove cookies arguments
      }

      await executeCommand("yt-dlp", videoArgs, { timeout: 300000 }); // 5 minutes timeout

      // Find the downloaded file
      const downloadedFiles = fs.readdirSync(tempDir).filter(f => f.includes(baseName) && f.endsWith('.mp4'));
      if (downloadedFiles.length === 0) {
        throw new Error("Video download failed - no file created");
      }

      const videoPath = path.join(tempDir, downloadedFiles[0]);
      
      // Check file size
      const stats = fs.statSync(videoPath);
      const maxSize = 2048 * 1024 * 1024;
      if (stats.size > maxSize) {
        fs.unlinkSync(videoPath);
        throw new Error(`Video too large (${(stats.size / 1024 / 1024).toFixed(1)}MB > 2048MB)`);
      }

      // Send video with progress indication
      await reply(`✅ Download complete! Sending video (${(stats.size / 1024 / 1024).toFixed(1)}MB)...`);

      await robin.sendMessage(
        from,
        {
          document: fs.readFileSync(videoPath),
          mimetype: "video/mp4",
          fileName: `${safeName(title)}_${selectedQuality}p.mp4`,
          caption: `🔞 ${title} (${selectedQuality}p)`
        },
        { quoted: mek }
      );

      /* ---------- CLEANUP ---------- */
      try {
        if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
        }
        // Clean any other temp files
        fs.readdirSync(tempDir).forEach(f => {
          if (f.includes(baseName)) {
            fs.unlinkSync(path.join(tempDir, f));
          }
        });
      } catch (cleanupErr) {
        console.log("Cleanup warning:", cleanupErr.message);
      }

    } catch (err) {
      console.error("Eporner Error:", err);
      
      // Cleanup on error
      try {
        fs.readdirSync(tempDir).forEach(f => {
          if (f.includes('ep_')) {
            fs.unlinkSync(path.join(tempDir, f));
          }
        });
      } catch (cleanupErr) {}
      
      reply(`❌ Eporner Error: ${err.message || "Unknown error"}`);
    }
  }
);
