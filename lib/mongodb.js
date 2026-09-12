const config = require('../config');

// ==================== CONNECT TO MONGODB ====================
const connectDB = async () => {
  console.log("🛜 Database disabled (Running in No-DB mode) ✅");
  return Promise.resolve();
};

module.exports = connectDB;
