# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a WhatsApp Link Dispatcher Service - a Node.js application that automates WhatsApp Web sessions to detect and forward links from messages. It uses Puppeteer for browser automation and provides multi-user session management with webhook integration.

## Development Commands

- **Start development server**: `npm run dev` (uses nodemon for auto-restart)
- **Start production server**: `npm start`
- **Install dependencies**: `npm install`

Note: There are no lint or test commands configured in package.json.

## Architecture

### Core Components

- **server.js**: Express server managing multiple WhatsApp bot instances
  - Multi-user bot management via Map data structure
  - RESTful API for bot lifecycle management
  - Graceful shutdown handling for all active sessions

- **whatsapp-bot-enhanced.js**: WhatsApp automation class using Puppeteer
  - Session persistence via cookies and localStorage
  - QR code generation and base64 conversion
  - Link detection in messages with regex filtering
  - Dual webhook system (user-specific + Supabase callback)

### API Endpoints

- `GET /status/:userId?` - Bot status (single user or all users)
- `POST /start` - Initialize new WhatsApp session
- `POST /stop` - Stop user session
- `POST /restart/:userId` - Restart specific session
- `GET /qr/:userId` - Retrieve QR code for authentication

### Session Management

- Sessions stored in `./sessions/${userId}` as JSON files
- QR codes saved to `./qr-codes/${userId}-qr.png`
- Automatic cleanup on disconnect

### Message Processing

- Real-time message monitoring via Puppeteer event listeners
- Link extraction using CSS selectors on `a[href]` elements
- Duplicate message prevention using Set-based tracking
- Concurrent webhook delivery to user endpoint and Supabase callback

## Environment Configuration

Create `.env` file from `.env.example`:
- `PORT`: Server port (default: 3000)
- `SUPABASE_WEBHOOK_URL`: Callback URL for status updates
- `DEFAULT_WEBHOOK_URL`: Optional fallback webhook

## Dependencies

- **puppeteer**: Browser automation for WhatsApp Web
- **express**: HTTP server framework
- **axios**: HTTP client for webhook delivery
- **dotenv**: Environment variable management