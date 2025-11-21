const mongoose = require('mongoose');

const historicalOddsSchema = new mongoose.Schema({
  sport: { 
    type: String, 
    required: true, 
    enum: ['nba', 'ncaa-basketball', 'ncaa-football', 'nfl']
  },
  gameId: { type: String, required: true },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  commenceTime: { type: Date, required: true },
  odds: { type: mongoose.Schema.Types.Mixed, default: {} },
  fetchedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for efficient queries
historicalOddsSchema.index({ sport: 1, gameId: 1, fetchedAt: -1 });
historicalOddsSchema.index({ sport: 1, commenceTime: -1 });
historicalOddsSchema.index({ gameId: 1, fetchedAt: -1 });
// Compound index for daily outcomes queries
historicalOddsSchema.index({ sport: 1, commenceTime: -1, fetchedAt: -1 });
// Unique index on gameId to prevent duplicates - always keep latest odds
historicalOddsSchema.index({ gameId: 1 }, { unique: true });

module.exports = mongoose.model('HistoricalOdds', historicalOddsSchema);

