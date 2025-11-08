const express = require('express');
const router = express.Router();
const { getBettingAnswer } = require('../services/aiService');

/**
 * POST /api/ai/ask
 * Ask a question about betting
 * Body: { question: string, gameContext?: object }
 */
router.post('/ask', async (req, res) => {
  try {
    const { question, gameContext } = req.body;

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

    // Validate gameContext if provided
    if (gameContext && typeof gameContext !== 'object') {
      return res.status(400).json({ 
        error: 'Game context must be an object' 
      });
    }

    // Get AI response with game context if provided
    const answer = await getBettingAnswer(question.trim(), gameContext || null);

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

