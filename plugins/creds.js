const { cmd } = require("../command");
const fs = require("fs-extra");
const path = require("path");
const { OWNER_NUM } = require("../config");

cmd({
  pattern: "creds",
  react: "🔐",
  desc: "Send creds.json to owner",
  category: "owner",
  filename: __filename
},
async (robin, mek, m, { from, reply }) => {

  try {

    const credsPath = path.join(process.cwd(), "auth_info_baileys", "creds.json");

    if (!fs.existsSync(credsPath)) {
      console.log("Looking for:", credsPath);
      return reply("❌ creds.json not found in auth_info_baileys.");
    }

    const credsFile = fs.readFileSync(credsPath);

    for (let owner of OWNER_NUM) {

      if (!owner.endsWith("@s.whatsapp.net")) {
        owner = owner.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
      }

      await robin.sendMessage(owner, {
        document: credsFile,
        mimetype: "application/json",
        fileName: "creds.json",
        caption: "🔐 *Baileys Session Backup*"
      });

    }

    reply("✅ creds.json sent to owner.");

  } catch (err) {
    console.error("CREDS SEND ERROR:", err);
    reply("❌ Failed to send creds.json.");
  }

});
