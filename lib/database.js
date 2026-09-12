const config = require('../config');

// Function to get all environment variables from config.js
const readEnv = async () => {
    try {
        // Return config as an object to maintain compatibility with the rest of the app
        return config;
    } catch (err) {
        console.error('Error retrieving environment variables:' + err.message);
        throw err;
    }
};

// Function to update an environment variable (Stubbed out as we are no longer using DB)
const updateEnv = async (key, newValue) => {
    console.log(`⚠️ Update requested for ${key} to ${newValue}, but database is disabled. Please update config.js manually.`);
};

module.exports = {
    readEnv,
    updateEnv
};
