const Odds = require('../models/Odds');
const HistoricalOdds = require('../models/HistoricalOdds');

class OddsDatabase {
  /**
   * Get odds for a specific sport
   */
  async getOddsForSport(sport) {
    try {
      const oddsDoc = await Odds.findOne({ sport });
      return oddsDoc ? oddsDoc.games : [];
    } catch (error) {
      console.error(`[ODDS] Error getting odds for ${sport}:`, error.message);
      return [];
    }
  }

  /**
   * Get all odds for all sports
   */
  async getAllOdds() {
    try {
      const allOdds = await Odds.find({});
      const result = {};
      allOdds.forEach(doc => {
        result[doc.sport] = doc.games;
      });
      return result;
    } catch (error) {
      console.error('[ODDS] Error getting all odds:', error.message);
      return {};
    }
  }

  /**
   * Get the last update time (checks the most recent update across all sports)
   */
  async getLastUpdateTime() {
    try {
      const mostRecent = await Odds.findOne({})
        .sort({ lastUpdated: -1 })
        .select('lastUpdated');
      return mostRecent ? mostRecent.lastUpdated.toISOString() : null;
    } catch (error) {
      console.error('[ODDS] Error getting last update time:', error.message);
      return null;
    }
  }

  /**
   * Check if odds need to be updated (haven't been updated today)
   */
  async needsUpdate() {
    try {
      const lastUpdate = await this.getLastUpdateTime();
      if (!lastUpdate) return true;
      
      const lastUpdateDate = new Date(lastUpdate).toDateString();
      const today = new Date().toDateString();
      return lastUpdateDate !== today;
    } catch (error) {
      console.error('[ODDS] Error checking if update needed:', error.message);
      return true; // Default to needing update on error
    }
  }

  /**
   * Update odds for all sports atomically
   * - Updates main Odds collection (current/upcoming games only - clean replacement)
   * - Archives all odds to HistoricalOdds collection (for daily outcomes processing)
   * Uses MongoDB's atomic operations to ensure only one update happens per day
   * Returns true if update was successful, false if already updated today
   */
  async updateOdds(newOdds) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today
      
      let anyUpdated = false;
      let historicalCount = 0;
      
      const updatePromises = Object.entries(newOdds).map(async ([sport, games]) => {
        try {
          // First, check if document exists and when it was last updated
          const existing = await Odds.findOne({ sport });
          
          if (existing) {
            // Document exists - check if it was updated today
            const lastUpdateDate = new Date(existing.lastUpdated).setHours(0, 0, 0, 0);
            const todayStart = today.getTime();
            
            if (lastUpdateDate >= todayStart) {
              // Already updated today, skip
              return null;
            }
          }
          
          // Archive all new odds to HistoricalOdds collection
          // Uses upsert to update existing games with latest odds (no duplicates)
          if (Array.isArray(games) && games.length > 0) {
            const bulkOps = games.map(game => ({
              updateOne: {
                filter: { gameId: game.id },
                update: {
                  $set: {
                    sport,
                    gameId: game.id,
                    homeTeam: game.homeTeam,
                    awayTeam: game.awayTeam,
                    commenceTime: game.commenceTime,
                    odds: game.odds,
                    fetchedAt: new Date()
                  }
                },
                upsert: true
              }
            }));
            
            try {
              const bulkResult = await HistoricalOdds.bulkWrite(bulkOps, { ordered: false });
              const upserted = bulkResult.upsertedCount || 0;
              const modified = bulkResult.modifiedCount || 0;
              historicalCount += upserted + modified;
              console.log(`[ODDS] ${sport}: archived ${upserted + modified} games to historical odds (${upserted} new, ${modified} updated)`);
            } catch (error) {
              console.error(`[ODDS] Error archiving historical odds for ${sport}:`, error.message);
            }
          }
          
          // Update main Odds collection (clean replacement for current games)
          const result = await Odds.findOneAndUpdate(
            { sport },
            {
              $set: {
                games: games || [],
                lastUpdated: new Date()
              }
            },
            { upsert: true, new: true }
          );
          
          if (result) {
            anyUpdated = true;
            console.log(`[ODDS] ${sport}: updated with ${(games || []).length} current games`);
          }
          return result;
        } catch (error) {
          // If it's a duplicate key error, the document was created by another process
          // Just skip it
          if (error.code === 11000) {
            console.log(`[ODDS] Document for ${sport} was created by another process, skipping`);
            return null;
          }
          throw error;
        }
      });

      await Promise.all(updatePromises);
      
      if (anyUpdated) {
        console.log(`[ODDS] Successfully updated odds: ${historicalCount} games archived to history`);
        return true;
      } else {
        console.log('[ODDS] Odds already updated today, skipping');
        return false;
      }
    } catch (error) {
      console.error('[ODDS] Error updating odds:', error.message);
      throw error;
    }
  }

  /**
   * Save odds to historical collection (simple method for easy calling)
   * This just archives odds without running the full outcomes processing
   */
  async saveHistoricalOdds(newOdds) {
    try {
      let totalArchived = 0;
      
      const archivePromises = Object.entries(newOdds).map(async ([sport, games]) => {
        if (!Array.isArray(games) || games.length === 0) return 0;
        
        const bulkOps = games.map(game => ({
          updateOne: {
            filter: { gameId: game.id },
            update: {
              $set: {
                sport,
                gameId: game.id,
                homeTeam: game.homeTeam,
                awayTeam: game.awayTeam,
                commenceTime: game.commenceTime,
                odds: game.odds,
                fetchedAt: new Date()
              }
            },
            upsert: true
          }
        }));
        
        try {
          const bulkResult = await HistoricalOdds.bulkWrite(bulkOps, { ordered: false });
          const upserted = bulkResult.upsertedCount || 0;
          const modified = bulkResult.modifiedCount || 0;
          return upserted + modified;
        } catch (error) {
          console.error(`[ODDS] Error saving historical odds for ${sport}:`, error.message);
          return 0;
        }
      });
      
      const results = await Promise.all(archivePromises);
      totalArchived = results.reduce((sum, count) => sum + count, 0);
      
      if (totalArchived > 0) {
        console.log(`[ODDS] Archived ${totalArchived} games to historical odds`);
      }
      
      return totalArchived;
    } catch (error) {
      console.error('[ODDS] Error saving historical odds:', error.message);
      throw error;
    }
  }

  /**
   * Get historical odds for a specific sport (for daily outcomes processing)
   */
  async getHistoricalOddsForSport(sport) {
    try {
      // Get the most recent odds snapshot for each game
      const historicalOdds = await HistoricalOdds.aggregate([
        { $match: { sport } },
        { $sort: { gameId: 1, fetchedAt: -1 } },
        {
          $group: {
            _id: '$gameId',
            game: { $first: '$$ROOT' }
          }
        },
        {
          $replaceRoot: { newRoot: '$game' }
        }
      ]);
      
      // Transform to match the format expected by daily outcomes script
      return historicalOdds.map(doc => ({
        id: doc.gameId,
        homeTeam: doc.homeTeam,
        awayTeam: doc.awayTeam,
        commenceTime: doc.commenceTime,
        odds: doc.odds,
        lastUpdated: doc.fetchedAt
      }));
    } catch (error) {
      console.error(`[ODDS] Error getting historical odds for ${sport}:`, error.message);
      return [];
    }
  }

  /**
   * Optional: Clean up very old odds (e.g., 30+ days old)
   * Call this periodically if storage becomes an issue
   */
  async cleanupOldOdds(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      cutoffDate.setHours(0, 0, 0, 0);
      
      const sports = ['nba', 'nfl', 'ncaa-basketball', 'ncaa-football'];
      let totalRemoved = 0;
      
      for (const sport of sports) {
        const existing = await Odds.findOne({ sport });
        if (!existing || !existing.games) continue;
        
        const gamesToKeep = existing.games.filter(game => {
          if (!game.commenceTime) return true; // Keep games without dates
          const gameDate = new Date(game.commenceTime);
          return gameDate >= cutoffDate;
        });
        
        const removed = existing.games.length - gamesToKeep.length;
        if (removed > 0) {
          await Odds.findOneAndUpdate(
            { sport },
            {
              $set: {
                games: gamesToKeep,
                lastUpdated: new Date()
              }
            }
          );
          totalRemoved += removed;
          console.log(`[ODDS] ${sport}: removed ${removed} games older than ${daysOld} days`);
        }
      }
      
      if (totalRemoved > 0) {
        console.log(`[ODDS] Cleanup complete: removed ${totalRemoved} old games`);
      }
      
      return totalRemoved;
    } catch (error) {
      console.error('[ODDS] Error cleaning up old odds:', error.message);
      throw error;
    }
  }
}

module.exports = new OddsDatabase();
