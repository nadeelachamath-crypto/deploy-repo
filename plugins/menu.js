const { readEnv } = require("../lib/database");
const { cmd, commands } = require("../command");
const { isOwner } = require("../lib/auth");

cmd(
  {
    pattern: "menu",
    alias: ["getmenu"],
    ownerOnly: true,
    react: "📝",
    desc: "Get command list",
    category: "main",
    filename: __filename,
  },
  async (robin, mek, m, { from, sender, reply }) => {
    try {
      const config = await readEnv();
      const PREFIX = config.PREFIX || ".";

      const userName =
        mek?.pushName || m?.pushName || sender?.split("@")[0] || "User";

      // Prepare menu categories
      let menu = {
        main: "",
        download: "",
        group: "",
        owner: "",
        convert: "",
        search: "",
        nsfw: "",
      };

      // Populate menu dynamically
      for (let i = 0; i < commands.length; i++) {
        const cmdItem = commands[i];
        if (!cmdItem.pattern || cmdItem.dontAddCommandList) continue;

        if (!menu[cmdItem.category]) menu[cmdItem.category] = "";
        menu[cmdItem.category] += `    👻 ${PREFIX}${cmdItem.pattern}\n`;
      }

      // Build menu in the style you like
      const madeMenu = `
👻 *Hello ${userName}*

| _*MAIN COMMANDS*_ |
    👻 ${config.PREFIX}menu
    👻 ${config.PREFIX}alive 
    👻 ${config.PREFIX}ping
    👻 ${config.PREFIX}cleartemp <for song cmd bug fix>
    👻 ${config.PREFIX}deauth <clear session>
    👻 ${config.PREFIX}auth <pin> <unlock Authorization>
    👻 ${config.PREFIX}set <change settings>
    👻 ${config.PREFIX}restart
    👻 ${config.PREFIX}update
     
| _*NSFW COMMANDS*_ |
    👻 ${config.PREFIX}nsfwimg <search tag if you want>
    👻 ${config.PREFIX}xhamster <xhamster url>
    👻 ${config.PREFIX}pornhub <pornhub url>
    👻 ${config.PREFIX}pornclip
    👻 ${config.PREFIX}eporner <eporner url>
    👻 ${config.PREFIX}pornpics <tag>
    👻 ${config.PREFIX}porngal <pornpic gallery url>
    👻 ${config.PREFIX}xnxx <xnxx url>
    👻 ${config.PREFIX}xanime <xanime porn url>
  
| _*DOWNLOAD COMMANDS*_ |
    👻 ${config.PREFIX}mega <mrga.nz url>
    👻 ${config.PREFIX}download <direct download url>
    👻 ${config.PREFIX}torrent <torrent magnet url>
    👻 ${config.PREFIX}save <one time file save>
    
| _*SOCIAL MEDIA DOWNLOAD COMMANDS*_ |
    👻 ${config.PREFIX}song <song name>
    👻 ${config.PREFIX}fb <fb video url>
    👻 ${config.PREFIX}tiktok <tiktok url>
    👻 ${config.PREFIX}video <yt video name>
    👻 ${config.PREFIX}ig <insta url>
    👻 ${config.PREFIX}ai <ask anything>
    
| _*CONVERT COMMANDS*_ |
    👻 ${config.PREFIX}sticker
    👻 ${config.PREFIX}toimg
    👻 ${config.PREFIX}wordlist 
    
| _*SEARCH COMMANDS*_ |
    👻 ${config.PREFIX}img <search tag>
    👻 ${config.PREFIX}bing <search tag>
    👻 ${config.PREFIX}1337x <xxx,movies,games><search tag>
    
🗿 CREATED BY Nadeela Chamath 🗿

> 👻 GHOST MD MENU MSG
`;
      await robin.sendMessage(
        from,
        {
          image: {
            url: "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true",
          },
          caption: madeMenu,
        },
        { quoted: mek }
      );
    } catch (e) {
      console.error("❌ Menu error:", e);
      reply(`❌ Error: ${e.message || e}`);
    }
  }
);
