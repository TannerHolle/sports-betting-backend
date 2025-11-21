const mongoose = require('mongoose');

const gameOutcomeSchema = new mongoose.Schema({
  gameId: { type: String, required: true },
  sport: { 
    type: String, 
    required: true, 
    enum: ['nba', 'ncaa-basketball', 'ncaa-football', 'nfl']
  },
  gameDate: { type: Date, required: true },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  
  // Odds data (from The Odds API)
  odds: {
    spread: {
      homeLine: { type: Number, default: null },
      awayLine: { type: Number, default: null },
      homePrice: { type: Number, default: null },
      awayPrice: { type: Number, default: null }
    },
    total: {
      overLine: { type: Number, default: null },
      underLine: { type: Number, default: null },
      overPrice: { type: Number, default: null },
      underPrice: { type: Number, default: null }
    },
    moneyline: {
      home: { type: Number, default: null },
      away: { type: Number, default: null }
    }
  },
  
  // Final results (from ESPN API)
  result: {
    homeScore: { type: Number, default: null },
    awayScore: { type: Number, default: null },
    totalPoints: { type: Number, default: null },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null }
  },
  
  // Calculated outcomes
  outcomes: {
    spreadCovered: { type: Boolean, default: null }, // true if favorite covered, false if not, null if push
    spreadPush: { type: Boolean, default: false },
    totalOver: { type: Boolean, default: null }, // true if over, false if under, null if push
    totalPush: { type: Boolean, default: false },
    homeWon: { type: Boolean, default: null }
  },
  
  // Metadata
  oddsFetchedAt: { type: Date, default: null },
  resultFetchedAt: { type: Date, default: null },
  processed: { type: Boolean, default: false }
}, { timestamps: true });

// Index for efficient queries
gameOutcomeSchema.index({ sport: 1, gameDate: -1 });
gameOutcomeSchema.index({ gameId: 1, sport: 1 }, { unique: true });
gameOutcomeSchema.index({ processed: 1, 'result.completed': 1 });

module.exports = mongoose.model('GameOutcome', gameOutcomeSchema);

