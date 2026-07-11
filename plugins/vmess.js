const { cmd } = require("../command");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");
const net = require("net");

const DEFAULT_DOMAIN = "ghost-tun.duckdns.org";
const DEFAULT_PORT = "443";

// ----------------------------
// PORT CHECK (SAFE)
// ----------------------------
function checkPort(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (status) => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(status);
      }
    };

    socket.setTimeout(4000);

    socket.on("connect", () => finish("🟢 OPEN"));
    socket.on("timeout", () => finish("🔴 TIMEOUT"));
    socket.on("error", () => finish("🔴 CLOSED"));

    socket.connect(port, host);
  });
}

// ----------------------------
// VPS FIREWALL FIX (SAFE)
// ----------------------------
function tryFixPort(port) {
  return new Promise((resolve) => {
    // try ufw first
    exec(`ufw allow ${port}/tcp`, (err) => {
      if (!err) return resolve("UFW OK");

      // fallback iptables
      exec(`iptables -A INPUT -p tcp --dport ${port} -j ACCEPT`, (err2) => {
        if (!err2) return resolve("IPTABLES OK");

        // fail safe (NO CRASH)
        resolve("NOT ALLOWED (NO ROOT OR FIREWALL)");
      });
    });
  });
}

// ----------------------------
// COMMAND
// ----------------------------
cmd(
  {
    pattern: "vmess",
    alias: ["vpnconfig"],
    react: "🌐",
    desc: "VMess VPS generator (safe)",
    category: "tools",
    filename: __filename,
  },
  async (robin, mek, m, { from, q, reply }) => {
    try {
      let domain = DEFAULT_DOMAIN;
      let port = DEFAULT_PORT;

      if (q) {
        const args = q.split(" ");
        if (args[0]) domain = args[0];
        if (args[1]) port = args[1];
      }

      if (!domain.includes(".")) {
        return reply("❌ Invalid domain");
      }

      if (isNaN(port)) {
        return reply("❌ Invalid port");
      }

      const uuid = uuidv4();

      // ----------------------------
      // PORT CHECK
      // ----------------------------
      let portStatus = await checkPort(domain, port);

      // ----------------------------
      // TRY FIX (ONLY IF CLOSED)
      // ----------------------------
      let fixStatus = "SKIPPED";

      if (portStatus !== "🟢 OPEN") {
        fixStatus = await tryFixPort(port);
        portStatus = "🟡 ATTEMPTED CHECK/FIX";
      }

      // ----------------------------
      // VMESS CONFIG
      // ----------------------------
      const config = {
        v: "2",
        ps: "GHOST-VPN",
        add: domain,
        port: parseInt(port),
        id: uuid,
        aid: "0",
        net: "tcp",
        type: "none",
        host: domain,
        tls: "tls",
      };

      const vmessLink =
        "vmess://" +
        Buffer.from(JSON.stringify(config)).toString("base64");

      // ----------------------------
      // RESPONSE
      // ----------------------------
      const msg =
`🌐 *GHOST VMESS VPS*

🔗 Server : ${domain}
📡 Port   : ${port}

📊 Status : ${portStatus}
🛠 Fix    : ${fixStatus}

🆔 UUID   : ${uuid}
🔐 Mode   : TCP + TLS

⚠️ NOTE:
- Bot does NOT guarantee firewall control
- VPS must allow inbound port manually if needed

📥 VMess Link:
${vmessLink}`;

      await robin.sendMessage(from, { text: msg }, { quoted: mek });

    } catch (err) {
      console.error(err);
      reply("❌ VMess system error");
    }
  }
);