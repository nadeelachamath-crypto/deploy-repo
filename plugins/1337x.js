const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");

cmd(
  {
    pattern: "1337x",
    react: "🌱",
    desc: "Search with clean magnet hash output",
    category: "tools",
    filename: __filename,
  },
  async (robin, mek, m, { q, reply }) => {
    let browser;
    try {
      if (!q) {
        return reply(
          `❗ Usage:
.1337x movies
.1337x movies harry potter
.1337x harry potter`
        );
      }

      reply("🔍 Fetching data via Browser (Bypassing 403)...");

      let url = "";
      const args = q.split(" ");
      const type = args[0].toLowerCase();
      const searchQuery = args.slice(1).join(" ");

      const validTypes = ["movies", "games", "anime", "music", "xxx"];

      if (validTypes.includes(type)) {
        if (searchQuery) {
          url = `https://www.1337x.la/search/${encodeURIComponent(searchQuery)}/1/`;
        } else {
          const map = {
            movies: "popular-movies",
            games: "popular-games",
            anime: "popular-anime",
            music: "popular-music",
            xxx: "popular-xxx",
          };
          url = `https://www.1337x.la/${map[type]}`;
        }
      } else {
        url = `https://www.1337x.la/search/${encodeURIComponent(q)}/1/`;
      }

      // Use Puppeteer to bypass Cloudflare/403
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      const content = await page.content();
      const $ = cheerio.load(content);

      // Limit results to 10 for performance since we use a browser for each item
      const rows = $("table.table-list tbody tr").slice(0, 10);
      const results = [];

      for (let i = 0; i < rows.length; i++) {
        const el = rows[i];
        const name = $(el).find("td.name a:nth-child(2)").text().trim();
        const linkTag = $(el).find("td.name a:nth-child(2)");
        const pageLink = linkTag.attr("href")
          ? "https://www.1337x.la" + linkTag.attr("href")
          : "";
        const seeds = $(el).find("td.seeds").text().trim();
        const size = $(el).find("td.size").text().trim();

        if (!pageLink || !name) continue;

        try {
          // Navigate to the detail page to get the magnet link
          await page.goto(pageLink, { waitUntil: "domcontentloaded", timeout: 30000 });
          const pageContent = await page.content();
          const $$ = cheerio.load(pageContent);
          const magnet = $$('a[href^="magnet:?xt="]').attr("href");

          let magnetHash = "Not found";
          if (magnet) {
            const match = magnet.match(/btih:([a-fA-F0-9]+)/i);
            if (match) magnetHash = match[1];
          }

          results.push(
            `🎬 *${name}*

📦 ${size}
🌱 ${seeds}
🧲 Hash: ${magnetHash}`
          );
        } catch (err) {
          results.push(
            `🎬 *${name}*

📦 ${size}
🌱 ${seeds}
⚠️ Hash: Not found`
          );
        }
      }

      if (!results.length) return reply("❌ No results found.");
      reply(results.join("\n\n"));

    } catch (e) {
      console.error("1337x error:", e.message);
      reply("❌ Failed to fetch data (Possible Cloudflare block).");
    } finally {
      if (browser) await browser.close();
    }
  }
);
