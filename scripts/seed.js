const { runSeedCommand } = require('../services/sampleLoader');

runSeedCommand().catch((error) => { console.error(error.message); process.exitCode = 1; });
