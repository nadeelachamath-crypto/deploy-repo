const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables from config.env if it exists
const configPath = path.resolve(__dirname, "config.env");
if (fs.existsSync(configPath)) {
  dotenv.config({ path: configPath });
}

function convertToBool(text, fault = "true") {
  return text?.toLowerCase() === fault.toLowerCase();
}

module.exports = {
  SESSION_ID: process.env.SESSION_ID || "CPoD0RLI#9iE1v1iua7D3OTzkmVHaN57frhpUB5s6-1Lksg7HEuM",
  MONGODB: process.env.MONGODB || "",
  OWNER_NUM: (process.env.OWNER_NUM || "94701981053").split(","),

  OLLAMA_HOST: "https://ollama.com",
  OLLAMA_MODEL: "gpt-oss:120b-cloud",
  OLLAMA_API_KEY: "5f90d76c4e3e4fba854e196ed2738790.I7PxUZBaIkR0ptskUglibBsk",
  AUTO_READ_MESSAGES: true,
  AUTH_SYSTEM: false,
  AUTO_READ_STATUS: true,
  AUTO_LIKE_STATUS: true,
  AUTO_REPLY_STATUS: false,
  STATUS_REACT_EMOJI: "👻",
  STATUS_REPLY_TEXT: "🔥 Nice status!",
  MODE: "groups",
  PREFIX: ".",
  AUTO_FAKE_TYPING: true,
  FAKE_TYPING_DELAY_MIN: 800,
  FAKE_TYPING_DELAY_MAX: 2000,

  ALIVE_IMG: process.env.ALIVE_IMG || "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true",
  ALIVE_MSG: process.env.ALIVE_MSG || "👻 Hello, I am alive now!!\n\n> Developer note \n> 👻 Ghost MD was created to be simple, smooth, and convenient — no unnecessary complications, just pure functionality.\n\n> 💀 CREATED by Nadeela Chamath 💀",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "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",
};
