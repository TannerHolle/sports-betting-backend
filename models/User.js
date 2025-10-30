const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 1000, min: 0 },
  totalWagered: { type: Number, default: 0, min: 0 },
  totalWon: { type: Number, default: 0, min: 0 },
  totalLost: { type: Number, default: 0, min: 0 },
  bets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bet' }]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);


