// ANPASSUNGEN FÜR DEINEN SERVER.JS

// 1. Multi-User Support hinzufügen
const whatsappBots = new Map(); // Statt: let whatsappBot = null;

// 2. Neue API-Endpoints
app.post('/start/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    if (whatsappBots.has(userId)) {
      await whatsappBots.get(userId).disconnect();
    }
    
    const bot = new WhatsAppBot(userId); // User ID übergeben
    await bot.initialize();
    whatsappBots.set(userId, bot);
    
    res.json({ success: true, message: 'Bot started successfully' });
  } catch (error) {
    console.error('Start failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/stop/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const bot = whatsappBots.get(userId);
    if (bot) {
      await bot.disconnect();
      whatsappBots.delete(userId);
    }
    res.json({ success: true, message: 'Bot stopped successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/status/:userId', (req, res) => {
  const { userId } = req.params;
  const bot = whatsappBots.get(userId);
  res.json({
    bot_connected: bot?.isConnected() || false,
    status: bot?.getStatus() || 'disconnected'
  });
});

app.get('/qr/:userId', async (req, res) => {
  const { userId } = req.params;
  const bot = whatsappBots.get(userId);
  if (bot) {
    const qrCode = await bot.getQRCode();
    res.json({ qr_code: qrCode });
  } else {
    res.status(404).json({ error: 'Bot not found' });
  }
});

// 3. Graceful shutdown für alle Bots
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  for (const [userId, bot] of whatsappBots) {
    await bot.disconnect();
  }
  process.exit(0);
});