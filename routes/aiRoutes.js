const express = require('express');
const router = express.Router();
const { getBettingAnswer } = require('../services/aiService');

/**
 * POST /api/ai/ask
 * Ask a question about betting
 */
router.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;

    // Validate input
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Question is required and must be a non-empty string' 
      });
    }

    // Limit question length
    if (question.length > 1000) {
      return res.status(400).json({ 
        error: 'Question is too long. Maximum 1000 characters.' 
      });
    }

    // Get AI response
    const answer = await getBettingAnswer(question.trim());

    res.json({
      success: true,
      question: question.trim(),
      answer
    });
  } catch (error) {
    console.error('Error in AI route:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process question. Please try again.' 
    });
  }
});

module.exports = router;

