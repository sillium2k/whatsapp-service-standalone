require('dotenv').config();
const express = require('express');
const WhatsAppBot = require('./whatsapp-bot-enhanced');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple CORS configuration for Railway
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  
  next();
});

app.use(express.json());

// Store multiple bot instances for different users
const whatsappBots = new Map();

app.get('/', (req, res) => {
  const activeBots = Array.from(whatsappBots.entries()).map(([userId, bot]) => ({
    userId,
    connected: bot.isConnected(),
    status: bot.getStatus()
  }));

  res.json({ 
    status: 'WhatsApp Service is running',
    active_bots: activeBots.length,
    bots: activeBots
  });
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    port: PORT
  });
});

app.get('/status/:userId?', (req, res) => {
  const { userId } = req.params;
  
  if (userId) {
    const bot = whatsappBots.get(userId);
    res.json({
      user_id: userId,
      bot_connected: bot?.isConnected() || false,
      status: bot?.getStatus() || 'disconnected',
      qr_available: bot?.hasQRCode() || false
    });
  } else {
    const allBots = Array.from(whatsappBots.entries()).map(([id, bot]) => ({
      user_id: id,
      connected: bot.isConnected(),
      status: bot.getStatus()
    }));
    
    res.json({
      total_bots: allBots.length,
      bots: allBots,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/start', async (req, res) => {
  try {
    const { userId, webhookUrl, callbackUrl } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log(`🚀 Starting WhatsApp bot for user: ${userId}`);
    
    // Stop existing bot for this user if any
    if (whatsappBots.has(userId)) {
      console.log(`⚠️ Stopping existing bot for ${userId}`);
      await whatsappBots.get(userId).disconnect();
      whatsappBots.delete(userId);
    }

    const bot = new WhatsAppBot(userId, {
      webhookUrl,
      callbackUrl: callbackUrl || process.env.SUPABASE_WEBHOOK_URL,
      sessionPath: `./sessions/${userId}`
    });

    whatsappBots.set(userId, bot);
    
    // Start bot initialization in background - don't wait
    (async () => {
      try {
        await bot.initialize();
      } catch (error) {
        console.error('🔥 Bot init failed:', error);
      }
    })();
    
    // Respond immediately with initializing status
    res.json({ 
      success: true, 
      message: 'Bot initialization started',
      status: 'initializing',
      qrCode: null,
      userId: userId
    });
  } catch (error) {
    console.error('Start failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


app.post('/stop', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const bot = whatsappBots.get(userId);
    if (bot) {
      await bot.disconnect();
      whatsappBots.delete(userId);
    }

    res.json({ success: true, message: 'Bot stopped successfully' });
  } catch (error) {
    console.error('Stop failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/restart/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { webhookUrl, callbackUrl } = req.body;

    // Stop existing bot
    if (whatsappBots.has(userId)) {
      await whatsappBots.get(userId).disconnect();
      whatsappBots.delete(userId);
    }

    // Start new bot
    const bot = new WhatsAppBot(userId, {
      webhookUrl,
      callbackUrl: callbackUrl || process.env.SUPABASE_WEBHOOK_URL,
      sessionPath: `./sessions/${userId}`
    });

    whatsappBots.set(userId, bot);
    await bot.initialize();
    
    res.json({ success: true, message: 'Bot restarted successfully' });
  } catch (error) {
    console.error('Restart failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/qr/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const bot = whatsappBots.get(userId);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found for user' });
    }

    const qrCode = await bot.getQRCode();
    res.json({ qrCode, userId });
  } catch (error) {
    console.error('QR fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// QR Code as image endpoint for direct display
app.get('/qr/:userId/image', async (req, res) => {
  try {
    const { userId } = req.params;
    const bot = whatsappBots.get(userId);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found for user' });
    }

    const qrCodeDataURL = bot.getQRCodeDataURL();
    if (!qrCodeDataURL) {
      return res.status(404).json({ error: 'QR code not available' });
    }

    // Extract base64 data and convert to buffer
    const base64Data = bot.getCleanBase64QR();
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(imageBuffer);
  } catch (error) {
    console.error('QR image fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/simulate', async (req, res) => {
  try {
    const { userId, testUrl, webhookUrl } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Simulate sending a test link to webhook
    const testPayload = {
      link: testUrl || 'https://linkedin.com/post/sample-test-url',
      message: 'This is a test message with a link',
      timestamp: new Date().toISOString(),
      group: 'Test Group',
      sender: 'Test User',
      userId: userId
    };

    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(testPayload)
        });
        
        console.log(`Test link sent to webhook: ${webhookUrl} - Status: ${response.status}`);
      } catch (error) {
        console.error('Failed to send test link to webhook:', error);
      }
    }

    res.json({ 
      success: true, 
      message: 'Test link simulation completed',
      payload: testPayload
    });
  } catch (error) {
    console.error('Simulate failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp Service running on port ${PORT}`);
  console.log(`Supabase webhook URL: ${process.env.SUPABASE_WEBHOOK_URL}`);
});

// Global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit, keep server running for other users
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, keep server running for other users
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  const shutdownPromises = Array.from(whatsappBots.values()).map(bot => bot.disconnect());
  await Promise.all(shutdownPromises);
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  
  const shutdownPromises = Array.from(whatsappBots.values()).map(bot => bot.disconnect());
  await Promise.all(shutdownPromises);
  
  process.exit(0);
});