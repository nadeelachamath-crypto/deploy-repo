const { cmd } = require("../command");
const axios = require("axios");
const { imageSearch } = require("@mudbill/duckduckgo-images-api");

// -------------------- Download Image --------------------
async function downloadImage(url) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 15000,
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://duckduckgo.com/",
            "Accept": "image/webp,image/apng,image/*,*/*;q=0.8"
        },
        validateStatus: (s) => s === 200
    });

    return Buffer.from(res.data);
}

// -------------------- Command --------------------
cmd(
{
    pattern: "img",
    alias: ["gimg", "gimage"],
    ownerOnly: true,
    react: "🔍",
    desc: "DuckDuckGo Image Search (SafeSearch OFF)",
    category: "search",
    filename: __filename,
},
async (robin, mek, m, { q, from, reply }) => {

    try {
        if (!q) {
            return reply("❌ Example: .img cats 5");
        }

        // -------- Parse count --------
        let args = q.split(" ");
        let count = 3;

        if (!isNaN(args[args.length - 1])) {
            count = parseInt(args.pop());
            if (count > 10) count = 10;
            if (count < 1) count = 1;
        }

        const query = args.join(" ");

        await reply(`🔍 Searching: *${query}* (${count})...`);

        // -------- SAFESEARCH OFF (FIXED) --------
        const results = await imageSearch({
            query: query,
            safeSearch: "off",   // 🔥 FORCE OFF
            iterations: 2        // more results
        });

        if (!results || results.length === 0) {
            return reply("❌ No images found.");
        }

        let sent = 0;
        let failed = 0;

        // -------- Loop --------
        for (let i = 0; i < results.length && sent < count; i++) {

            try {
                const imageUrl = results[i].image;

                // Skip bad/blocked sources
                if (!imageUrl) continue;
                if (imageUrl.includes("thumbnail")) continue;
                if (imageUrl.includes("pinterest")) continue;
                if (imageUrl.includes("shutterstock")) continue;

                const buffer = await downloadImage(imageUrl);

                if (!buffer || buffer.length < 5000) continue; // skip tiny/broken

                await robin.sendMessage(from, {
                    image: buffer,
                    caption: `🖼️ *Result ${sent + 1}/${count}*\n🔎 ${query}`
                }, { quoted: mek });

                sent++;

                // small delay (prevents ban / rate limit)
                await new Promise(r => setTimeout(r, 800));

            } catch (err) {
                failed++;
                console.log("Image fail:", err.message);
                continue;
            }
        }

        // -------- Final Status --------
        if (sent === 0) {
            return reply("❌ Failed to fetch images.");
        }

        if (failed > 0) {
            await reply(`✅ Sent ${sent} images (${failed} failed)`);
        }

    } catch (err) {
        console.error("IMG CMD ERROR:", err);
        reply("❌ Search failed.");
    }
});
