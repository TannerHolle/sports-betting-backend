const express = require('express');
const router = express.Router();
const Suggestion = require('../models/Suggestion');
const User = require('../models/User');

// Create suggestion
router.post('/', async (req, res) => {
  try {
    const { username, suggestion } = req.body;
    
    if (!username || !suggestion) {
      return res.status(400).json({ error: 'Username and suggestion are required' });
    }
    
    if (!suggestion.trim()) {
      return res.status(400).json({ error: 'Suggestion cannot be empty' });
    }
    
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const newSuggestion = new Suggestion({
      user: user._id,
      username: user.username,
      suggestion: suggestion.trim(),
      status: 'new'
    });
    
    await newSuggestion.save();
    res.status(201).json({ success: true, suggestion: newSuggestion });
  } catch (error) {
    console.error('Error creating suggestion:', error);
    res.status(500).json({ error: 'Failed to submit suggestion', details: error.message });
  }
});

// Get suggestions
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status) {
      query.status = status;
    }
    
    const suggestions = await Suggestion.find(query)
      .populate('user', 'username')
      .sort({ createdAt: -1 });
    
    res.json(suggestions);
  } catch (error) {
    console.error('Error fetching suggestions:', error);
    res.status(500).json({ error: 'Failed to load suggestions', details: error.message });
  }
});

// Update suggestion
router.put('/:suggestionId', async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { status, adminNotes } = req.body;
    
    const suggestion = await Suggestion.findById(suggestionId);
    if (!suggestion) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }
    
    if (status) {
      suggestion.status = status;
    }
    if (adminNotes !== undefined) {
      suggestion.adminNotes = adminNotes;
    }
    
    await suggestion.save();
    res.json({ success: true, suggestion });
  } catch (error) {
    console.error('Error updating suggestion:', error);
    res.status(500).json({ error: 'Failed to update suggestion', details: error.message });
  }
});

module.exports = router;

