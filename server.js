require('dotenv').config();
const express = require('express');
const WhatsAppBot = require('./whatsapp-bot-enhanced');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes - Railway specific configuration
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Allow all origins for Railway deployment
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
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

    // Railway environment check
    if (process.env.RAILWAY_ENVIRONMENT && !process.env.PUPPETEER_EXECUTABLE_PATH) {
      return res.status(503).json({ 
        success: false, 
        error: 'Puppeteer not configured for Railway environment. Chrome executable path required.' 
      });
    }

    // Stop existing bot for this user if any
    if (whatsappBots.has(userId)) {
      try {
        await whatsappBots.get(userId).disconnect();
      } catch (disconnectError) {
        console.warn('Error disconnecting existing bot:', disconnectError.message);
      }
      whatsappBots.delete(userId);
    }

    const bot = new WhatsAppBot(userId, {
      webhookUrl,
      callbackUrl: callbackUrl || process.env.SUPABASE_WEBHOOK_URL,
      sessionPath: `./sessions/${userId}`
    });

    whatsappBots.set(userId, bot);
    
    // Add timeout to prevent Railway from killing the process
    const initTimeout = setTimeout(() => {
      console.error(`Bot initialization timeout for user ${userId}`);
      whatsappBots.delete(userId);
    }, 30000);
    
    try {
      await bot.initialize();
      clearTimeout(initTimeout);
      
      const qrCode = await bot.getQRCode();
      
      res.json({ 
        success: true, 
        message: 'Bot started successfully',
        status: bot.getStatus(),
        qrCode: qrCode,
        userId: userId
      });
    } catch (initError) {
      clearTimeout(initTimeout);
      whatsappBots.delete(userId);
      throw initError;
    }
  } catch (error) {
    console.error('Start failed:', error);
    
    // Clean up on error
    if (whatsappBots.has(req.body.userId)) {
      try {
        await whatsappBots.get(req.body.userId).disconnect();
      } catch (cleanupError) {
        console.warn('Error during cleanup:', cleanupError.message);
      }
      whatsappBots.delete(req.body.userId);
    }
    
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WhatsApp Service running on port ${PORT}`);
  console.log(`Supabase webhook URL: ${process.env.SUPABASE_WEBHOOK_URL}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
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