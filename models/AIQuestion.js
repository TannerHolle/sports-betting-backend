const mongoose = require('mongoose');

const aiQuestionSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  answer: { type: String, trim: true }, // AI response to the question
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional user reference
  username: { type: String, trim: true }, // Store username for easy reference if available
  // Game context information (if provided)
  gameContext: {
    sport: { type: String, trim: true },
    homeTeam: { type: String, trim: true },
    awayTeam: { type: String, trim: true },
    gameId: { type: String, trim: true }
  }
}, { timestamps: true });

module.exports = mongoose.model('AIQuestion', aiQuestionSchema);

