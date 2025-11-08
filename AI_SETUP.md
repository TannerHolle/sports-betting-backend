# AI Chat Feature Setup

The AI chat feature uses OpenAI's GPT-4o-mini model to answer betting-related questions. This model is cost-effective and provides excellent performance for educational betting content.

## Setup Instructions

1. **Get an OpenAI API Key**
   - Sign up at https://platform.openai.com/
   - Navigate to API Keys section
   - Create a new API key

2. **Add API Key to Environment Variables**
   - Create a `.env` file in the `backend` directory (if it doesn't exist)
   - Add the following line:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```
   - Replace `your_api_key_here` with your actual OpenAI API key

3. **Restart the Backend Server**
   - The server needs to be restarted to load the new environment variable
   - Run `npm run dev` or `npm start` in the backend directory

## Usage

Once set up, users can:
- Navigate to the "Betting Assistant" page from the navigation
- Ask questions about sports betting
- Get helpful, educational responses about betting concepts, odds, strategies, and more

## Features

- Answers questions about betting odds, types of bets, strategies, and more
- Educational and informative responses
- Cost-effective using GPT-4o-mini (over 60% cheaper than GPT-3.5-turbo)
- No authentication required (public feature)

## API Endpoint

- **POST** `/api/ai/ask`
- **Body**: `{ "question": "Your question here" }`
- **Response**: `{ "success": true, "question": "...", "answer": "..." }`

## Error Handling

The service handles various error cases:
- Missing or invalid API key
- Rate limiting
- Service unavailability
- Invalid requests

