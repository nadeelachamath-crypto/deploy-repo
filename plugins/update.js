const { cmd } = require("../command");
const { isOwner } = require("../lib/auth");
const fs = require("fs");
const path = require("path");

cmd({
  pattern: "update",
  react: "🧹",
  ownerOnly: true,
  desc: "Delete plugins, cookies, lib then restart",
  category: "owner",
  filename: __filename,
}, async (robin, mek, m, { reply, sender }) => {

  if (!isOwner(sender)) return reply("🚫 *You are not authorized!*");

  try {

    const pluginsDir = path.resolve(__dirname, "../plugins");
    const cookiesDir = path.resolve(__dirname, "../cookies");
    const libDir = path.resolve(__dirname, "../lib");

    /* ===== DELETE FOLDER FUNCTION ===== */
    function deleteFolder(dir) {
      if (!fs.existsSync(dir)) return;

      for (const file of fs.readdirSync(dir)) {
        const curPath = path.join(dir, file);

        if (fs.lstatSync(curPath).isDirectory()) {
          deleteFolder(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      }

      fs.rmdirSync(dir);
    }

    /* ===== DELETE TARGET FOLDERS ===== */
    deleteFolder(pluginsDir);
    deleteFolder(cookiesDir);
    deleteFolder(libDir);

    await reply(
      "🧹 *Plugins, Cookies & Lib deleted!*\n♻️ *Restarting bot...*"
    );

    /* ===== RESTART ===== */
    setTimeout(() => {
      process.exit(0);
    }, 800);

  } catch (e) {
    console.error(e);
    reply("❌ Update failed: " + e.message);
  }

});
