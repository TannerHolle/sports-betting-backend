const mongoose = require('mongoose');

const suggestionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true }, // Store username for easy reference
  suggestion: { type: String, required: true, trim: true },
  status: { type: String, enum: ['new', 'reviewed', 'implemented', 'rejected'], default: 'new' },
  adminNotes: { type: String, trim: true }
}, { timestamps: true });

module.exports = mongoose.model('Suggestion', suggestionSchema);

