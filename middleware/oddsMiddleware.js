const oddsService = require('../services/oddsService');
const oddsDatabase = require('../services/oddsDatabase');

const checkAndUpdateOdds = async (req, res, next) => {
  try {
    const needsUpdate = await oddsDatabase.needsUpdate();
    if (needsUpdate) {
      const lastUpdate = await oddsDatabase.getLastUpdateTime();
      console.log(`[ODDS] Starting daily odds fetch. Last update: ${lastUpdate || 'never'}`);
      try {
        const freshOdds = await oddsService.fetchAllOdds();
        const processedOdds = {};
        for (const [sport, oddsData] of Object.entries(freshOdds)) {
          processedOdds[sport] = oddsService.processOddsData(oddsData, sport);
        }
        await oddsDatabase.updateOdds(processedOdds);
        const newUpdate = await oddsDatabase.getLastUpdateTime();
        console.log(`[ODDS] Completed. New update time: ${newUpdate}`);
      } catch (error) {
        console.error('[ODDS] Failed to update odds:', error.message);
      }
    }
    next();
  } catch (error) {
    console.error('Error in odds middleware:', error.message);
    next();
  }
};

module.exports = { checkAndUpdateOdds };


