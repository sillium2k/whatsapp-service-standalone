require('dotenv').config();
const express = require('express');
const WhatsAppBot = require('./whatsapp-bot-enhanced');

const app = express();
const PORT = process.env.PORT || 3000;

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

    // Stop existing bot for this user if any
    if (whatsappBots.has(userId)) {
      await whatsappBots.get(userId).disconnect();
      whatsappBots.delete(userId);
    }

    const bot = new WhatsAppBot(userId, {
      webhookUrl,
      callbackUrl: callbackUrl || process.env.SUPABASE_WEBHOOK_URL,
      sessionPath: `./sessions/${userId}`
    });

    whatsappBots.set(userId, bot);
    
    await bot.initialize();
    
    const qrCode = await bot.getQRCode();
    
    res.json({ 
      success: true, 
      message: 'Bot started successfully',
      status: bot.getStatus(),
      qrCode: qrCode,
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

app.listen(PORT, () => {
  console.log(`WhatsApp Service running on port ${PORT}`);
  console.log(`Supabase webhook URL: ${process.env.SUPABASE_WEBHOOK_URL}`);
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