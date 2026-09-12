const { cmd } = require("../command");
const ytsr = require("yt-search");
const ytdlp = require("yt-dlp-exec");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs-extra");
const path = require("path");
const { spawnSync } = require("child_process");

/* =========================================================
   COOKIE FILES
========================================================= */

const COOKIE_CANDIDATES = [
  path.join(__dirname, "../cookies/yt.txt"),
  path.join(__dirname, "../cookies/youtube_cookies.txt"),
  path.join(process.cwd(), "cookies/yt.txt"),
  path.join(process.cwd(), "cookies/youtube_cookies.txt"),
];

function findCookiesFile() {
  return COOKIE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

/* =========================================================
   HELPERS
========================================================= */

function safeFileName(name, max = 80) {
  return String(name || "song")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || "song";
}

function tailLines(text = "", n = 18) {
  return String(text)
    .split("\n")
    .filter(Boolean)
    .slice(-n)
    .join("\n");
}

function getYtDlpText(err) {
  return [
    err?.stderr || "",
    err?.stdout || "",
    err?.message || "",
  ]
    .filter(Boolean)
    .join("\n");
}

function containsRequestedFormatError(text = "") {
  const t = String(text).toLowerCase();

  return (
    t.includes("requested format is not available") ||
    t.includes("requested format not available") ||
    t.includes("no video formats found")
  );
}

function detectReason(text = "") {
  const t = String(text).toLowerCase();

  if (
    t.includes("sign in to confirm") ||
    t.includes("not a bot") ||
    t.includes("confirm you're not a bot")
  ) {
    return "YouTube bot-check. The cookies may be expired or rejected.";
  }

  if (t.includes("private video") || t.includes("login required")) {
    return "Private / login-required video.";
  }

  if (
    t.includes("signature solving failed") ||
    t.includes("challenge solving failed") ||
    t.includes("javascript runtime") ||
    t.includes("js runtime")
  ) {
    return "YouTube JavaScript challenge could not be solved. Check the JS runtime/EJS setup.";
  }

  if (t.includes("429") || t.includes("too many requests")) {
    return "Rate limited by YouTube (HTTP 429).";
  }

  if (t.includes("403") || t.includes("forbidden")) {
    return "YouTube returned HTTP 403 Forbidden.";
  }

  if (
    t.includes("video unavailable") ||
    t.includes("unavailable") ||
    t.includes("has been removed")
  ) {
    return "Video unavailable / removed.";
  }

  if (t.includes("age-restricted")) {
    return "Age-restricted video could not be accessed.";
  }

  if (t.includes("empty")) {
    return "Downloaded file is empty.";
  }

  return "Unknown yt-dlp error.";
}

/* =========================================================
   JAVASCRIPT RUNTIME DETECTION
========================================================= */

/*
 * yt-dlp currently relies on a JS runtime for modern YouTube
 * extraction. Prefer Deno when available, otherwise Node.
 */

function commandExists(command) {
  try {
    const result = spawnSync(
      process.platform === "win32" ? "where" : "which",
      [command],
      {
        stdio: "ignore",
        shell: false,
      }
    );

    return result.status === 0;
  } catch {
    return false;
  }
}

function getJsRuntime() {
  if (commandExists("deno")) {
    return "deno";
  }

  if (commandExists("node")) {
    return "node";
  }

  return null;
}

/* =========================================================
   COMMON YT-DLP OPTIONS
========================================================= */

function getYtDlpOptions(COOKIE_PATH) {
  const options = {
    cookies: COOKIE_PATH,

    // Current YouTube challenge solving
    remoteComponents: "ejs:github",

    // Don't download playlists
    noPlaylist: true,

    // Keep output clean
    quiet: true,
    noWarnings: true,

    // Retry network failures
    retries: 3,
    fragmentRetries: 3,

    // Don't abort immediately on transient HTTP issues
    extractorRetries: 3,
  };

  const jsRuntime = getJsRuntime();

  if (jsRuntime) {
    options.jsRuntimes = jsRuntime;
  }

  return options;
}

/* =========================================================
   PARSE DUMP SINGLE JSON
========================================================= */

function normalizeJsonResult(result) {
  if (!result) {
    return null;
  }

  if (typeof result === "object") {
    return result;
  }

  try {
    return JSON.parse(String(result));
  } catch {
    return null;
  }
}

/* =========================================================
   FORMAT DISCOVERY
========================================================= */

async function discoverBestAudioFormat(url, COOKIE_PATH) {
  const options = {
    ...getYtDlpOptions(COOKIE_PATH),

    dumpSingleJson: true,
    skipDownload: true,
  };

  const result = await ytdlp(url, options);

  const info = normalizeJsonResult(result);

  if (!info) {
    throw new Error("yt-dlp returned invalid JSON while discovering formats.");
  }

  const formats = Array.isArray(info.formats) ? info.formats : [];

  if (!formats.length) {
    throw new Error("No formats were returned by yt-dlp.");
  }

  /*
   * First preference:
   * audio-only formats
   */
  let audioFormats = formats.filter((format) => {
    const hasAudio =
      format &&
      format.acodec &&
      format.acodec !== "none";

    const videoIsAbsent =
      !format.vcodec ||
      format.vcodec === "none";

    return hasAudio && videoIsAbsent;
  });

  /*
   * If no audio-only stream exists, use any stream that
   * contains audio.
   */
  if (!audioFormats.length) {
    audioFormats = formats.filter(
      (format) =>
        format &&
        format.acodec &&
        format.acodec !== "none"
    );
  }

  if (!audioFormats.length) {
    throw new Error("No audio-capable formats are available.");
  }

  /*
   * Score formats.
   *
   * Prefer:
   *   1. higher audio bitrate
   *   2. m4a / webm
   *   3. larger quality value
   */
  audioFormats.sort((a, b) => {
    const abrA = Number(a.abr || 0);
    const abrB = Number(b.abr || 0);

    if (abrA !== abrB) {
      return abrB - abrA;
    }

    const extScore = (ext) => {
      if (ext === "m4a") return 3;
      if (ext === "webm") return 2;
      if (ext === "opus") return 1;
      return 0;
    };

    const extA = extScore(a.ext);
    const extB = extScore(b.ext);

    if (extA !== extB) {
      return extB - extA;
    }

    return Number(b.tbr || 0) - Number(a.tbr || 0);
  });

  return {
    info,
    format: audioFormats[0],
  };
}

/* =========================================================
   FIND DOWNLOADED AUDIO FILE
========================================================= */

async function findAudioFile(tempDir) {
  const files = await fs.readdir(tempDir);

  const ignored = new Set([
    "audio.mp3",
    "audio.mp3.part",
    "audio.mp3.ytdl",
  ]);

  const candidates = files
    .filter((file) => !ignored.has(file))
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();

      return [
        ".webm",
        ".m4a",
        ".mp4",
        ".aac",
        ".opus",
        ".ogg",
        ".wav",
        ".mp3",
      ].includes(ext);
    });

  if (!candidates.length) {
    return null;
  }

  let best = null;
  let bestSize = 0;

  for (const file of candidates) {
    const full = path.join(tempDir, file);

    try {
      const stat = await fs.stat(full);

      if (stat.isFile() && stat.size > bestSize) {
        best = full;
        bestSize = stat.size;
      }
    } catch {
      // Ignore files that disappear during download
    }
  }

  return best;
}

/* =========================================================
   DOWNLOAD AUDIO
========================================================= */

async function downloadAudio(url, tempDir, COOKIE_PATH) {
  /*
   * IMPORTANT:
   * Do NOT force .webm.
   *
   * Let yt-dlp keep the native container:
   *   audio.webm
   *   audio.m4a
   *   etc.
   */

  const outputTemplate = path.join(
    tempDir,
    "audio.%(ext)s"
  );

  const baseOptions = {
    ...getYtDlpOptions(COOKIE_PATH),

    output: outputTemplate,

    /*
     * Flexible selector:
     *
     * 1. best audio-only stream
     * 2. otherwise best format with audio
     * 3. otherwise best available format
     */
    format: "bestaudio/best[acodec!=none]/best",
  };

  /* -------------------------------------------------------
     ATTEMPT 1: Flexible selector
  ------------------------------------------------------- */

  try {
    await ytdlp(url, baseOptions);

    const file = await findAudioFile(tempDir);

    if (file) {
      return file;
    }

    throw new Error(
      "yt-dlp finished but no audio file was created."
    );
  } catch (firstError) {
    const firstOutput = getYtDlpText(firstError);

    console.log(
      "Primary audio download failed:\n",
      tailLines(firstOutput, 20)
    );

    /*
     * Only do expensive format discovery if the error
     * specifically indicates a format problem.
     *
     * For cookies/auth/403/etc., preserve the original error.
     */
    if (!containsRequestedFormatError(firstOutput)) {
      throw firstError;
    }
  }

  /* -------------------------------------------------------
     ATTEMPT 2: Discover formats and select a real format ID
  ------------------------------------------------------- */

  const discovered = await discoverBestAudioFormat(
    url,
    COOKIE_PATH
  );

  const selected = discovered.format;

  console.log("Selected audio format:", {
    formatId: selected.format_id,
    ext: selected.ext,
    acodec: selected.acodec,
    abr: selected.abr,
    protocol: selected.protocol,
    formatNote: selected.format_note,
  });

  if (!selected.format_id) {
    throw new Error(
      "yt-dlp discovered an audio format but no format ID was returned."
    );
  }

  const retryOutputTemplate = path.join(
    tempDir,
    "audio.%(ext)s"
  );

  const retryOptions = {
    ...getYtDlpOptions(COOKIE_PATH),

    output: retryOutputTemplate,

    /*
     * Use the exact format that was discovered.
     */
    format: String(selected.format_id),
  };

  await ytdlp(url, retryOptions);

  const file = await findAudioFile(tempDir);

  if (!file) {
    throw new Error(
      "Format was selected successfully, but yt-dlp did not create an audio file."
    );
  }

  return file;
}

/* =========================================================
   FFMPEG CONVERSION
========================================================= */

function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec("libmp3lame")
      .audioBitrate(320)
      .audioFrequency(48000)
      .format("mp3")
      .on("start", (commandLine) => {
        console.log("FFmpeg:", commandLine);
      })
      .on("progress", (progress) => {
        if (progress.percent !== undefined) {
          console.log(
            `FFmpeg progress: ${progress.percent.toFixed(1)}%`
          );
        }
      })
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

/* =========================================================
   COMMAND
========================================================= */

cmd(
  {
    pattern: "song",
    ownerOnly: true,
    react: "🎵",
    desc: "Download Song using yt-dlp",
    category: "download",
    filename: __filename,
  },

  async (robin, mek, m, { from, q, reply }) => {
    const id = Date.now();
    const tempDir = path.resolve(
      process.cwd(),
      "temp",
      String(id)
    );

    let mp3Path = null;

    try {
      /* ---------------------------------------------------
         INPUT
      --------------------------------------------------- */

      if (!q) {
        return reply(
          "*Please provide a song name or YouTube URL.*"
        );
      }

      /* ---------------------------------------------------
         COOKIES
      --------------------------------------------------- */

      const COOKIE_PATH = findCookiesFile();

      if (!COOKIE_PATH) {
        return reply(
          "❌ *YouTube cookies file not found!*\n\n" +
            "Put your cookies file in one of these locations:\n\n" +
            "• `cookies/yt.txt`\n" +
            "• `cookies/youtube_cookies.txt`\n"
        );
      }

      console.log(
        "🍪 Using cookies:",
        COOKIE_PATH
      );

      /* ---------------------------------------------------
         SEARCH
      --------------------------------------------------- */

      let search;

      try {
        search = await ytsr(q);
      } catch (searchError) {
        console.error(
          "YouTube search error:",
          searchError
        );

        return reply(
          "❌ Unable to search YouTube right now."
        );
      }

      const data = search.videos?.[0];

      if (!data) {
        return reply(
          "❌ Song not found."
        );
      }

      /* ---------------------------------------------------
         CREATE TEMP DIRECTORY
      --------------------------------------------------- */

      await fs.ensureDir(tempDir);

      /* ---------------------------------------------------
         INFORMATION MESSAGE
      --------------------------------------------------- */

      const desc =
        `*🎵 GHOST SONG DOWNLOADER 👻*\n\n` +
        `👻 *Title:* ${data.title}\n` +
        `👻 *Duration:* ${data.timestamp || "Unknown"}\n` +
        `👻 *Uploaded:* ${data.ago || "Unknown"}\n` +
        `👻 *Views:* ${data.views || "Unknown"}\n` +
        `👻 *URL:* ${data.url}\n\n` +
        `🍪 *Cookies:* ✅ Loaded\n` +
        `⚙️ *Format:* Auto-detect\n\n` +
        `📥 *Downloading Song…*`;

      await robin.sendMessage(
        from,
        {
          image: {
            url: data.thumbnail,
          },
          caption: desc,
        },
        {
          quoted: mek,
        }
      );

      /* ---------------------------------------------------
         DOWNLOAD
      --------------------------------------------------- */

      let sourceAudio;

      try {
        sourceAudio = await downloadAudio(
          data.url,
          tempDir,
          COOKIE_PATH
        );
      } catch (downloadError) {
        const output = getYtDlpText(
          downloadError
        );

        const reason = detectReason(output);

        console.error(
          "❌ yt-dlp error:",
          output
        );

        await fs.remove(tempDir).catch(() => {});

        return reply(
          `❌ *Download failed.*\n\n` +
            `🧠 *Reason:* ${reason}\n\n` +
            `📌 *yt-dlp output:*\n` +
            "```text\n" +
            `${tailLines(output, 18)}` +
            "\n```"
        );
      }

      /* ---------------------------------------------------
         VALIDATE SOURCE FILE
      --------------------------------------------------- */

      if (
        !sourceAudio ||
        !fs.existsSync(sourceAudio)
      ) {
        await fs.remove(tempDir).catch(() => {});

        return reply(
          "❌ yt-dlp did not produce an audio file."
        );
      }

      const sourceStat = await fs.stat(
        sourceAudio
      );

      if (sourceStat.size < 20 * 1024) {
        await fs.remove(tempDir).catch(() => {});

        return reply(
          "❌ The downloaded audio file is unexpectedly small."
        );
      }

      console.log(
        "✅ Downloaded source:",
        sourceAudio
      );

      console.log(
        "📦 Size:",
        sourceStat.size,
        "bytes"
      );

      /* ---------------------------------------------------
         CONVERT TO MP3
      --------------------------------------------------- */

      mp3Path = path.join(
        tempDir,
        "audio.mp3"
      );

      try {
        await convertToMp3(
          sourceAudio,
          mp3Path
        );
      } catch (ffmpegError) {
        console.error(
          "❌ FFmpeg error:",
          ffmpegError
        );

        await fs.remove(tempDir).catch(
          () => {}
        );

        return reply(
          "❌ FFmpeg could not convert the downloaded audio to MP3."
        );
      }

      /* ---------------------------------------------------
         VALIDATE MP3
      --------------------------------------------------- */

      if (!fs.existsSync(mp3Path)) {
        await fs.remove(tempDir).catch(
          () => {}
        );

        return reply(
          "❌ MP3 conversion failed."
        );
      }

      const mp3Stat = await fs.stat(
        mp3Path
      );

      if (mp3Stat.size < 20 * 1024) {
        await fs.remove(tempDir).catch(
          () => {}
        );

        return reply(
          "❌ Generated MP3 is unexpectedly small."
        );
      }

      /* ---------------------------------------------------
         SEND AUDIO
      --------------------------------------------------- */

      await robin.sendMessage(
        from,
        {
          audio: {
            url: mp3Path,
          },
          mimetype: "audio/mpeg",
          ptt: false,
        },
        {
          quoted: mek,
        }
      );

      /* ---------------------------------------------------
         SEND DOCUMENT
      --------------------------------------------------- */

      await robin.sendMessage(
        from,
        {
          document: {
            url: mp3Path,
          },
          mimetype: "audio/mpeg",
          fileName:
            `${safeFileName(data.title)}.mp3`,
          caption:
            `👻 *${data.title}*`,
        },
        {
          quoted: mek,
        }
      );

      /* ---------------------------------------------------
         CLEANUP
      --------------------------------------------------- */

      await fs.remove(tempDir);

      await reply(
        "*✅ Song downloaded successfully!* 👻"
      );
    } catch (err) {
      console.error(
        "❌ Song Error:",
        err
      );

      await fs.remove(tempDir).catch(
        () => {}
      );

      return reply(
        "❌ Error: " +
          (err?.message || "Unknown error")
      );
    }
  }
);
