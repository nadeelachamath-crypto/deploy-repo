/**
 * TORRENT DOWNLOADER (MAGNET + HASH SUPPORT)
 * - Supports magnet links OR BTIH hash
 * - Download up to 2GB
 * - Non-blocking
 */

const { cmd } = require("../command");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

const DOWNLOAD_DIR = path.join(__dirname, "../temp");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// 🔥 convert hash → magnet
function buildMagnet(hash) {
  return `magnet:?xt=urn:btih:${hash}`;
}

cmd(
  {
    pattern: "torrent",
    ownerOnly: true,
    react: "🧲",
    desc: "Download torrent using magnet or hash",
    category: "download",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    if (!q) {
      return reply(
        "❌ Send a magnet link or hash\n\nExample:\n.torrent magnet:?xt=...\n.torrent E21C3FB6EF97C9767..."
      );
    }

    let magnet = q.trim();

    // 🔥 IF INPUT IS HASH (40 hex chars)
    const hashMatch = magnet.match(/^[a-fA-F0-9]{40}$/);

    if (hashMatch) {
      magnet = buildMagnet(hashMatch[0]);
    }

    if (!magnet.startsWith("magnet:")) {
      return reply("❌ Invalid input. Send magnet or 40-char hash.");
    }

    let progressMsg = await reply("🧲 *Initializing torrent...*");

    try {
      const WebTorrent = (await import("webtorrent")).default;
      const client = new WebTorrent();

      // 🛡️ FIX 1: Prevent bot crash on global client errors
      client.on("error", (err) => {
        console.error("WebTorrent Client Error:", err.message);
      });

      setImmediate(() => {
        client.add(magnet, async (torrent) => {
          console.log("Torrent started:", torrent.name);

          // 🛡️ FIX 2: Prevent bot crash on specific torrent errors
          torrent.on("error", (err) => {
            console.error("Torrent Error:", err.message);
            reply("❌ Torrent error: " + err.message);
            client.destroy();
          });

          const progressInterval = setInterval(async () => {
            if (!torrent || torrent.destroyed) {
              clearInterval(progressInterval);
              return;
            }
            const percent = Math.round(torrent.progress * 100);
            const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
            const eta = Math.round(torrent.timeRemaining / 1000);

            try {
              await robin.sendMessage(
                from,
                {
                  text:
                    `🧲 *Downloading...*\n\n` +
                    `📂 ${torrent.name}\n` +
                    `📊 ${percent}%\n` +
                    `⚡ ${speed} MB/s\n` +
                    `⏳ ${eta}s`,
                  edit: progressMsg.key,
                },
                { quoted: mek }
              );
            } catch (e) {
              console.error("Progress update failed:", e.message);
            }
          }, 10000);

          torrent.on("done", async () => {
            clearInterval(progressInterval);

            try {
              const file = torrent.files.sort((a, b) => b.length - a.length)[0];
              if (!file) throw new Error("No files found in torrent");

              const filePath = path.join(DOWNLOAD_DIR, file.name);

              await new Promise((resolve, reject) => {
                file.createReadStream()
                  .pipe(fs.createWriteStream(filePath))
                  .on("finish", resolve)
                  .on("error", reject);
              });

              const fileSize = fs.statSync(filePath).size;

              // ✅ 2GB LIMIT KEPT EXACTLY AS REQUESTED
              if (fileSize > 2 * 1024 * 1024 * 1024) {
                fs.unlinkSync(filePath);
                return reply("❌ File too large (max 2GB).");
              }

              const mimetype = mime.lookup(file.name) || "application/octet-stream";

              await robin.sendMessage(
                from,
                {
                  text: `🎉 Download complete:\n📂 ${file.name}`,
                  edit: progressMsg.key,
                },
                { quoted: mek }
              );

              await robin.sendMessage(
                from,
                {
                  document: fs.readFileSync(filePath),
                  fileName: file.name,
                  mimetype,
                },
                { quoted: mek }
              );

              fs.unlinkSync(filePath);
            } catch (fileErr) {
              console.error("File processing error:", fileErr);
              reply("❌ Error processing downloaded file.");
            } finally {
              client.destroy();
            }
          });
        });
      });

    } catch (err) {
      console.error(err);
      reply("❌ Error: " + err.message);
    }
  }
);
