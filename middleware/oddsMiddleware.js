const oddsService = require('../services/oddsService');
const oddsDatabase = require('../services/oddsDatabase');

// Simple in-memory lock to prevent multiple API calls within the same process
// MongoDB's atomic operations handle cross-process protection
let updateInProgress = null;

const checkAndUpdateOdds = async (req, res, next) => {
  try {
    // If an update is already in progress, wait for it
    if (updateInProgress) {
      console.log(`[ODDS] Update already in progress, waiting...`);
      try {
        await updateInProgress;
      } catch (error) {
        // Even if the update failed, continue to serve cached data
        console.error('[ODDS] Waited for update but it failed:', error.message);
      }
      return next();
    }

    // Check if we need an update
    const needsUpdate = await oddsDatabase.needsUpdate();
    
    if (!needsUpdate) {
      // No update needed, serve cached data
      return next();
    }

    // We need an update - create update promise
    const updatePromise = (async () => {
      try {
        // Double-check (another request might have updated while we were waiting)
        const stillNeedsUpdate = await oddsDatabase.needsUpdate();
        if (!stillNeedsUpdate) {
          console.log(`[ODDS] Update no longer needed (another request completed it)`);
          return;
        }

        const lastUpdate = await oddsDatabase.getLastUpdateTime();
        console.log(`[ODDS] Starting daily odds fetch. Last update: ${lastUpdate || 'never'}`);
        
        // Fetch fresh odds from API
        const freshOdds = await oddsService.fetchAllOdds();
        const processedOdds = {};
        for (const [sport, oddsData] of Object.entries(freshOdds)) {
          processedOdds[sport] = oddsService.processOddsData(oddsData, sport);
        }
        
        // Update in database (atomic - only first one succeeds if multiple processes try)
        const updated = await oddsDatabase.updateOdds(processedOdds);
        if (updated) {
          const newUpdate = await oddsDatabase.getLastUpdateTime();
          console.log(`[ODDS] Completed. New update time: ${newUpdate}`);
          
          // Historical odds are already saved by updateOdds, so we're done
        } else {
          console.log(`[ODDS] Another process already updated odds today`);
        }
      } catch (error) {
        console.error('[ODDS] Failed to update odds:', error.message);
        throw error;
      } finally {
        // Clear the in-memory lock
        if (updateInProgress === updatePromise) {
          updateInProgress = null;
        }
      }
    })();
    
    // Set the in-memory lock immediately
    updateInProgress = updatePromise;
    
    // Wait for update to complete (but don't block the request)
    updatePromise.catch(error => {
      // Error already logged above
    });
    
    next();
  } catch (error) {
    console.error('Error in odds middleware:', error.message);
    next();
  }
};

module.exports = { checkAndUpdateOdds };


