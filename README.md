# WhatsApp Link Dispatcher Service

This Node.js service provides WhatsApp Web automation for link detection and forwarding. It works in conjunction with your Supabase application.

## Features

- Multi-user WhatsApp Web sessions
- QR code generation and management
- Automatic link detection in messages
- Webhook forwarding to configured endpoints
- Session persistence
- Real-time status updates

## Installation

1. Clone or download this service directory
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables in `.env`

## Configuration

Update your `.env` file with:

- `PORT`: Port for the service (default: 3000)
- `SUPABASE_WEBHOOK_URL`: Your Supabase webhook endpoint
- `DEFAULT_WEBHOOK_URL`: Optional default webhook for link forwarding

## Running the Service

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## API Endpoints

- `GET /` - Service status
- `GET /status/:userId?` - Get bot status for user or all users
- `POST /start` - Start WhatsApp session for user
- `POST /stop` - Stop WhatsApp session for user
- `POST /restart/:userId` - Restart session for user
- `GET /qr/:userId` - Get QR code for user

## Deployment Options

### 1. Railway (Recommended)
1. Connect your GitHub repo to Railway
2. Set environment variables
3. Deploy

### 2. Render
1. Create new Web Service
2. Connect repository
3. Configure environment
4. Deploy

### 3. VPS/Server
1. Upload files to server
2. Install Node.js and dependencies
3. Configure environment
4. Use PM2 for process management:
   ```bash
   npm install -g pm2
   pm2 start server.js --name whatsapp-service
   ```

## Integration with Supabase

1. Deploy this service to your preferred platform
2. Update your Supabase Edge Function with the service URL:
   ```typescript
   const whatsappServiceUrl = 'https://your-service-url.com';
   ```
3. Configure the webhook endpoint in Supabase

## Security Notes

- Use HTTPS in production
- Consider implementing API authentication
- Regularly update dependencies
- Monitor resource usage

## Troubleshooting

- Check logs for connection issues
- Ensure WhatsApp Web is accessible
- Verify webhook URLs are reachable
- Monitor memory usage (Puppeteer can be resource-intensive)