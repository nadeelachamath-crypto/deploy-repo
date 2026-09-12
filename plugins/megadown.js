const { cmd } = require("../command");
const mega = require("megajs");

const fs = require("fs");
const os = require("os");
const path = require("path");
const mime = require("mime-types");
const archiver = require("archiver");

/* =======================================================
   HELPERS
======================================================= */

function formatSize(bytes) {
  if (!bytes) return "0 MB";

  if (bytes >= 1024 ** 3) {
    return (bytes / 1024 ** 3).toFixed(2) + " GB";
  }

  return (bytes / 1024 ** 2).toFixed(2) + " MB";
}

function safeName(name = "mega_file") {
  return name
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();
}

async function streamToFile(stream, filePath) {
  return new Promise((resolve, reject) => {

    const write = fs.createWriteStream(filePath);

    stream.pipe(write);

    write.on("finish", resolve);
    write.on("error", reject);

    stream.on("error", reject);
  });
}

async function zipFolder(sourceDir, outPath) {
  return new Promise((resolve, reject) => {

    const output = fs.createWriteStream(outPath);

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    output.on("close", resolve);

    archive.on("error", reject);

    archive.pipe(output);

    archive.directory(sourceDir, false);

    archive.finalize();
  });
}

async function safeEdit(robin, from, editKey, text) {
  try {
    await robin.sendMessage(from, {
      text,
      edit: editKey,
    });
  } catch {}
}

/* =======================================================
   SINGLE FILE DOWNLOAD
======================================================= */

async function downloadSingleFile({
  robin,
  from,
  mek,
  file,
  reply,
}) {

  let tmpPath;

  try {

    await file.loadAttributes();

    const fileName = safeName(
      file.name || "mega_file"
    );

    const total = file.size || 0;

    const totalText = formatSize(total);

    tmpPath = path.join(
      os.tmpdir(),
      `${Date.now()}_${fileName}`
    );

    /* ---------- START MESSAGE ---------- */

    const msg = await robin.sendMessage(from, {
      text:
        `📦 *${fileName}*\n` +
        `📁 ${totalText}\n` +
        `⏬ Downloading: 0%`,
    });

    const editKey = msg.key;

    /* ---------- DOWNLOAD ---------- */

    const stream = file.download({
      highWaterMark: 1024 * 1024 * 5,
    });

    let downloaded = 0;
    let lastPercent = -1;
    let lastEditTime = 0;

    stream.on("data", async (chunk) => {

      downloaded += chunk.length;

      const percent = Math.floor(
        (downloaded / total) * 100
      );

      const now = Date.now();

      /* ---------- THROTTLE ---------- */

      if (
        percent === lastPercent ||
        now - lastEditTime < 3000
      ) return;

      lastPercent = percent;
      lastEditTime = now;

      await safeEdit(
        robin,
        from,
        editKey,
        `📦 *${fileName}*\n` +
        `📁 ${totalText}\n` +
        `⏬ Downloading: ${percent}%\n` +
        `📥 ${formatSize(downloaded)} / ${totalText}`
      );
    });

    await streamToFile(stream, tmpPath);

    /* ---------- COMPLETE ---------- */

    await safeEdit(
      robin,
      from,
      editKey,
      `📦 *${fileName}*\n` +
      `📁 ${totalText}\n` +
      `✅ Download Complete\n` +
      `📤 Uploading...`
    );

    /* ---------- MIME ---------- */

    const mimeType =
      mime.lookup(fileName) ||
      "application/octet-stream";

    /* ---------- SEND FILE ---------- */

    await robin.sendMessage(
      from,
      {
        document: fs.readFileSync(tmpPath),
        mimetype: mimeType,
        fileName: fileName,
      },
      { quoted: mek }
    );

    /* ---------- CLEAN ---------- */

    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }

    await safeEdit(
      robin,
      from,
      editKey,
      `📦 *${fileName}*\n` +
      `📁 ${totalText}\n` +
      `✅ Upload Complete`
    );

  } catch (err) {

    console.log("FILE ERROR:", err);

    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }

    return reply(
      "❌ File download failed.\n\n" +
      err.message
    );
  }
}

/* =======================================================
   FOLDER DOWNLOAD
======================================================= */

async function downloadFolder({
  robin,
  from,
  mek,
  folder,
  reply,
}) {

  let tempDir;
  let zipPath;

  try {

    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mega_")
    );

    /* ---------- LOAD ---------- */

    await folder.loadAttributes();

    if (!folder.children) {
      return reply(
        "❌ Could not load folder."
      );
    }

    const folderName = safeName(
      folder.name || "mega_folder"
    );

    /* ---------- FILES ---------- */

    const files = Object.values(folder.children)
      .filter(
        (f) =>
          f &&
          !f.directory &&
          typeof f.download === "function"
      );

    if (!files.length) {
      return reply("❌ Folder is empty.");
    }

    /* ---------- TOTAL SIZE ---------- */

    let totalBytes = 0;

    for (const file of files) {
      totalBytes += file.size || 0;
    }

    let downloadedBytes = 0;
    let lastPercent = -1;
    let lastEditTime = 0;

    /* ---------- START MESSAGE ---------- */

    const progressMsg =
      await robin.sendMessage(from, {
        text:
          `📂 *${folderName}*\n` +
          `📦 Files: ${files.length}\n` +
          `📁 ${formatSize(totalBytes)}\n` +
          `⏬ Starting download...`,
      });

    const editKey = progressMsg.key;

    /* ---------- DOWNLOAD ---------- */

    for (const file of files) {

      try {

        const fileName = safeName(
          file.name ||
          `file_${Date.now()}`
        );

        const savePath = path.join(
          tempDir,
          fileName
        );

        const stream = file.download({
          highWaterMark: 1024 * 1024 * 5,
        });

        stream.on("data", async (chunk) => {

          downloadedBytes += chunk.length;

          const percent = Math.floor(
            (downloadedBytes / totalBytes) * 100
          );

          const now = Date.now();

          /* ---------- THROTTLE ---------- */

          if (
            percent === lastPercent ||
            now - lastEditTime < 3000
          ) return;

          lastPercent = percent;
          lastEditTime = now;

          await safeEdit(
            robin,
            from,
            editKey,
            `📂 *${folderName}*\n` +
            `📦 Files: ${files.length}\n` +
            `📄 Current: ${fileName}\n\n` +
            `⏬ Downloading: ${percent}%\n` +
            `📥 ${formatSize(downloadedBytes)} / ${formatSize(totalBytes)}`
          );
        });

        await streamToFile(
          stream,
          savePath
        );

        console.log(
          "Downloaded:",
          fileName
        );

      } catch (e) {

        console.log(
          "Skipped:",
          file.name,
          e.message
        );
      }
    }

    /* ---------- ZIP ---------- */

    const zipName =
      `${folderName}.zip`;

    zipPath = path.join(
      os.tmpdir(),
      zipName
    );

    await safeEdit(
      robin,
      from,
      editKey,
      `📂 *${folderName}*\n` +
      `✅ Download Complete\n` +
      `📦 Creating ZIP...`
    );

    await zipFolder(
      tempDir,
      zipPath
    );

    const zipSize = formatSize(
      fs.statSync(zipPath).size
    );

    /* ---------- UPLOAD ---------- */

    await safeEdit(
      robin,
      from,
      editKey,
      `📂 *${folderName}*\n` +
      `📁 ${zipSize}\n` +
      `📤 Uploading ZIP...`
    );

    await robin.sendMessage(
      from,
      {
        document: fs.readFileSync(zipPath),
        mimetype: "application/zip",
        fileName: zipName,
      },
      { quoted: mek }
    );

    /* ---------- COMPLETE ---------- */

    await safeEdit(
      robin,
      from,
      editKey,
      `📂 *${folderName}*\n` +
      `📁 ${zipSize}\n` +
      `✅ ZIP Upload Complete`
    );

    /* ---------- CLEAN ---------- */

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    }

    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

  } catch (err) {

    console.log("FOLDER ERROR:", err);

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    }

    if (zipPath && fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    return reply(
      "❌ Folder download failed.\n\n" +
      err.message
    );
  }
}

/* =======================================================
   COMMAND
======================================================= */

cmd(
  {
    pattern: "mega",
    ownerOnly: true,
    react: "📦",
    desc: "MEGA file/folder downloader",
    filename: __filename,
  },

  async (robin, mek, m, {
    from,
    q,
    reply,
  }) => {

    try {

      if (!q) {
        return reply(
          "❌ Please provide a MEGA link."
        );
      }

      /* ---------- FOLDER ---------- */

      if (q.includes("/folder/")) {

        const folder =
          mega.File.fromURL(q);

        return await downloadFolder({
          robin,
          from,
          mek,
          folder,
          reply,
        });
      }

      /* ---------- SINGLE FILE ---------- */

      const file =
        mega.File.fromURL(q);

      return await downloadSingleFile({
        robin,
        from,
        mek,
        file,
        reply,
      });

    } catch (err) {

      console.log("MEGA ERROR:", err);

      return reply(
        "❌ Download failed.\n\n" +
        (err.message || "Unknown error")
      );
    }
  }
);
