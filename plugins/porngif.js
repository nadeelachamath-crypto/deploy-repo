const { cmd } = require("../command");
const axios = require("axios");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static"); // install: npm i ffmpeg-static
const { tmpdir } = require("os");
const { promisify } = require("util");
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

ffmpeg.setFfmpegPath(ffmpegPath);

let cachedToken = null;
let tokenExpire = 0;

// Get temporary RedGifs token
async function getRedgifsToken() {
  if (cachedToken && Date.now() < tokenExpire) return cachedToken;

  const { data } = await axios.get("https://api.redgifs.com/v2/auth/temporary", { timeout: 10000 });
  cachedToken = data?.token;
  tokenExpire = Date.now() + 50 * 60 * 1000; // 50 mins
  return cachedToken;
}

// Compress video for WhatsApp
function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v libx264",
        "-preset fast",
        "-crf 16",
        "-maxrate 1M",
        "-bufsize 2M",
        "-c:a aac",
        "-b:a 128k",
        "-movflags +faststart",
        "-pix_fmt yuv420p"
      ])
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

cmd(
  {
    pattern: "pornclip",
    react: "🍑",
    desc: "Send a RedGifs video (NSFW)",
    category: "nsfw",
    filename: __filename,
  },
  async (robin, mek, m, { q, reply, from }) => {
    try {
      const defaultTags = ["ass", "tits", "blowjob", "anal", "latina"];
      let tag = q?.trim().toLowerCase() || defaultTags[Math.floor(Math.random() * defaultTags.length)];

      await reply(`🔍 Searching for: *${tag}*`);

      const token = await getRedgifsToken();
      if (!token) return reply("❌ Failed to get authentication token.");

      // Fetch first page first to get total results
      const { data: firstPage } = await axios.get("https://api.redgifs.com/v2/gifs/search", {
        params: { search_text: tag, count: 50, page: 1, order: "trending" },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });

      const totalCount = firstPage?.total || 0;
      if (totalCount === 0) return reply(`❌ No results for: *${tag}*`);

      const maxPage = Math.ceil(totalCount / 50);
      const randomPage = Math.floor(Math.random() * maxPage) + 1;

      // Fetch random page
      const { data } = await axios.get("https://api.redgifs.com/v2/gifs/search", {
        params: { search_text: tag, count: 50, page: randomPage, order: "trending" },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });

      const gifs = data?.gifs || [];
      if (gifs.length === 0) return reply(`❌ No results on page ${randomPage} for: *${tag}*`);

      // Filter short MP4 videos (<=60s)
      const filtered = gifs.filter(g => {
        const duration = g.duration || 0;
        return duration <= 60 && (g.urls?.sd?.endsWith(".mp4") || g.urls?.hd?.endsWith(".mp4"));
      });

      if (filtered.length === 0) return reply("❌ No suitable MP4 results found.");

      const selected = filtered[Math.floor(Math.random() * filtered.length)];
      const videoUrl = selected.urls.sd || selected.urls.hd;

      //await reply("⬇️ Downloading video...");

      const videoResponse = await axios.get(videoUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://redgifs.com/",
        },
      });

      const tempInput = `${tmpdir()}/${Date.now()}_input.mp4`;
      const tempOutput = `${tmpdir()}/${Date.now()}_output.mp4`;

      try {
        await writeFileAsync(tempInput, videoResponse.data);
        //await reply("🔄 Compressing video for WhatsApp...");

        try {
          await compressVideo(tempInput, tempOutput);
        } catch {
          await reply("⚠️ Compression failed, sending original video...");
          fs.copyFileSync(tempInput, tempOutput);
        }

        //await reply("⬆️ Sending video...");

        await robin.sendMessage(
          from,
          {
            video: { url: tempOutput },
            caption: `🎥 ${selected.title || tag}\n⏱️ Duration: ${Math.round(selected.duration || 0)}s`,
            mimetype: "video/mp4",
            fileName: "video.mp4",
          },
          { quoted: mek }
        );
      } finally {
        try { await unlinkAsync(tempInput); } catch {}
        try { await unlinkAsync(tempOutput); } catch {}
      }

    } catch (err) {
      console.error("RedGifs error:", err.response?.data || err.message);
      cachedToken = null; // reset token on failure
      reply("❌ Failed to process video. Try again.");
    }
  }
);
