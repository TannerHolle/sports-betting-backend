const mongoose = require('mongoose');

// One selection inside a parlay. Mirrors the fields of a straight Bet so the
// same resolution logic can grade it.
const legSchema = new mongoose.Schema({
  gameId: { type: String, required: true },
  betType: { type: String, enum: ['moneyline', 'spread', 'total'], required: true },
  selection: { type: String, required: true },
  odds: { type: String, required: true },
  line: { type: String, default: null },
  sport: { type: String, default: null },
  gameData: { type: mongoose.Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['pending', 'won', 'lost', 'push'], default: 'pending' },
  actualResult: { type: mongoose.Schema.Types.Mixed, default: null },
  resolvedAt: { type: Date, default: null }
}, { _id: true });

const parlaySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  legs: {
    type: [legSchema],
    validate: [
      { validator: v => v.length >= 2, msg: 'A parlay needs at least 2 legs' },
      { validator: v => v.length <= 10, msg: 'A parlay can have at most 10 legs' }
    ]
  },
  amount: { type: Number, required: true, min: 0 },
  // Combined price at the time the parlay was placed, e.g. "+264"
  odds: { type: String, required: true },
  potentialWin: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['pending', 'won', 'lost', 'push'], default: 'pending' },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true });

parlaySchema.index({ status: 1 });
parlaySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Parlay', parlaySchema);
