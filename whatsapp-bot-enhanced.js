const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class WhatsAppBot {
  constructor(userId, options = {}) {
    this.userId = userId;
    this.browser = null;
    this.page = null;
    this.connected = false;
    this.status = 'disconnected';
    this.sessionPath = options.sessionPath || `./sessions/${userId}`;
    this.webhookUrl = options.webhookUrl;
    this.callbackUrl = options.callbackUrl;
    this.processedMessages = new Set();
    this.qrCode = null;
    this.qrCodePath = `./qr-codes/${userId}-qr.png`;
  }

  async initialize() {
    try {
      console.log(`Launching browser for user ${this.userId}...`);
      
      this.status = 'initializing';
      await this.notifyStatusChange();

      // Railway/Docker optimized Puppeteer configuration
      const puppeteerOptions = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--disable-domain-reliability',
          '--disable-features=AudioServiceOutOfProcess',
          '--disable-hang-monitor',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-web-security',
          '--metrics-recording-only',
          '--no-default-browser-check',
          '--no-experiments',
          '--password-store=basic',
          '--use-mock-keychain',
          '--single-process'
        ]
      };

      // Add executable path for Railway if available
      if (process.env.RAILWAY_ENVIRONMENT) {
        puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
      }

      this.browser = await puppeteer.launch(puppeteerOptions);

      this.page = await this.browser.newPage();
      
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      await this.loadSession();
      
      console.log(`Navigating to WhatsApp Web for user ${this.userId}...`);
      await this.page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle2' });
      
      await this.waitForConnection();
      
      console.log(`WhatsApp Web connected successfully for user ${this.userId}`);
      this.connected = true;
      this.status = 'connected';
      await this.notifyStatusChange();
      
      await this.startMessageMonitoring();
      
    } catch (error) {
      console.error(`Failed to initialize WhatsApp bot for user ${this.userId}:`, error);
      this.status = 'error';
      await this.notifyStatusChange();
      throw error;
    }
  }

  async loadSession() {
    try {
      if (fs.existsSync(this.sessionPath)) {
        console.log(`Loading existing session for user ${this.userId}...`);
        const sessionData = fs.readFileSync(this.sessionPath, 'utf8');
        const session = JSON.parse(sessionData);
        
        for (const cookie of session.cookies) {
          await this.page.setCookie(cookie);
        }
        
        if (session.localStorage) {
          await this.page.evaluateOnNewDocument((localStorage) => {
            for (const [key, value] of Object.entries(localStorage)) {
              window.localStorage.setItem(key, value);
            }
          }, session.localStorage);
        }
      }
    } catch (error) {
      console.log(`No valid session found for user ${this.userId}, will need to scan QR code`);
    }
  }

  async saveSession() {
    try {
      const cookies = await this.page.cookies();
      const localStorage = await this.page.evaluate(() => {
        const items = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          items[key] = window.localStorage.getItem(key);
        }
        return items;
      });

      const session = { cookies, localStorage };
      
      if (!fs.existsSync(path.dirname(this.sessionPath))) {
        fs.mkdirSync(path.dirname(this.sessionPath), { recursive: true });
      }
      
      fs.writeFileSync(this.sessionPath, JSON.stringify(session, null, 2));
      console.log(`Session saved successfully for user ${this.userId}`);
    } catch (error) {
      console.error(`Failed to save session for user ${this.userId}:`, error);
    }
  }

  async waitForConnection() {
    console.log(`Waiting for WhatsApp connection for user ${this.userId}...`);
    
    this.status = 'connecting';
    await this.notifyStatusChange();

    const timeout = 300000; // 5 minutes - increased for Railway environment
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        // Check if QR code is present
        const qrCode = await this.page.$('[data-ref]');
        if (qrCode) {
          console.log(`QR Code detected for user ${this.userId}. Please scan with your phone.`);
          
          this.status = 'qr_ready';
          
          // Take screenshot of QR code
          try {
            // Ensure qr-codes directory exists
            if (!fs.existsSync('./qr-codes')) {
              fs.mkdirSync('./qr-codes', { recursive: true });
            }

            await this.page.screenshot({ 
              path: this.qrCodePath,
              clip: await qrCode.boundingBox()
            });
            
            // Convert to base64 for sending to callback
            const qrBuffer = fs.readFileSync(this.qrCodePath);
            this.qrCode = `data:image/png;base64,${qrBuffer.toString('base64')}`;
            
            console.log(`QR code screenshot saved for user ${this.userId}`);
            await this.notifyQRCode();
            
          } catch (screenshotError) {
            console.log(`Could not save QR code screenshot for user ${this.userId}`);
          }
        }
        
        // Check if we're logged in
        const chatList = await this.page.$('[data-testid="chat-list"]');
        if (chatList) {
          console.log(`Successfully connected to WhatsApp Web for user ${this.userId}`);
          await this.saveSession();
          this.qrCode = null; // Clear QR code once connected
          return true;
        }
        
        await this.page.waitForTimeout(2000);
      } catch (error) {
        // Continue trying
      }
    }
    
    throw new Error(`Failed to connect to WhatsApp Web within timeout period for user ${this.userId}`);
  }

  async startMessageMonitoring() {
    console.log(`Starting message monitoring for user ${this.userId}...`);
    
    // Monitor for new messages
    this.page.on('response', async (response) => {
      if (response.url().includes('/app/chat') || response.url().includes('web.whatsapp.com')) {
        try {
          await this.checkForNewMessages();
        } catch (error) {
          console.error(`Error checking messages for user ${this.userId}:`, error);
        }
      }
    });

    // Initial check
    await this.checkForNewMessages();
    
    // Set up periodic checking
    this.messageCheckInterval = setInterval(() => {
      this.checkForNewMessages().catch(console.error);
    }, 5000); // Check every 5 seconds
  }

  async checkForNewMessages() {
    try {
      // Get all message elements
      const messages = await this.page.$$('[data-testid="msg-container"]');
      
      for (const message of messages) {
        try {
          const messageId = await message.evaluate(el => el.getAttribute('data-id'));
          
          if (!messageId || this.processedMessages.has(messageId)) {
            continue;
          }
          
          // Check if message contains links
          const links = await message.$$eval('a[href]', links => 
            links
              .map(link => link.href)
              .filter(href => href.startsWith('http'))
          );
          
          if (links.length > 0) {
            console.log(`Found ${links.length} link(s) in message for user ${this.userId}:`, links);
            
            // Get message text and sender info
            const messageText = await message.$eval('[data-testid="conversation-compose-box-input"]', el => el.textContent).catch(() => '');
            const senderName = await message.$eval('[data-testid="message-author"]', el => el.textContent).catch(() => 'Unknown');
            
            for (const link of links) {
              await this.dispatchLink(link, senderName, messageText);
            }
          }
          
          this.processedMessages.add(messageId);
        } catch (messageError) {
          // Skip this message if we can't process it
          console.error(`Error processing message for user ${this.userId}:`, messageError);
        }
      }
    } catch (error) {
      console.error(`Error in checkForNewMessages for user ${this.userId}:`, error);
    }
  }

  async dispatchLink(link, sender, messageText) {
    try {
      // First, send to user's webhook if configured
      if (this.webhookUrl) {
        const payload = {
          link: link,
          sender: sender,
          message: messageText,
          timestamp: new Date().toISOString(),
          source: 'whatsapp-web',
          user_id: this.userId
        };

        console.log(`Dispatching link to user webhook for ${this.userId}:`, payload);

        const response = await axios.post(this.webhookUrl, payload, {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        });

        console.log(`Link dispatched to user webhook successfully for ${this.userId}`);
      }

      // Then, send to Supabase callback if configured
      if (this.callbackUrl) {
        const callbackPayload = {
          type: 'link_detected',
          userId: this.userId,
          link: link,
          message: messageText,
          sender: sender,
          timestamp: new Date().toISOString()
        };

        await axios.post(this.callbackUrl, callbackPayload, {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        });

        console.log(`Link sent to Supabase callback for ${this.userId}`);
      }

    } catch (error) {
      console.error(`Failed to dispatch link for user ${this.userId}:`, error.message);
    }
  }

  async notifyStatusChange() {
    if (this.callbackUrl) {
      // Make webhook call non-blocking to prevent crashes
      setImmediate(async () => {
        try {
          const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'WhatsApp-Bot-Enhanced/1.0'
          };
          
          // Add Supabase auth if service role key is available
          if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
            headers['Authorization'] = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
          }
          
          await axios.post(this.callbackUrl, {
            type: 'connection_status',
            userId: this.userId,
            status: this.status,
            timestamp: new Date().toISOString()
          }, {
            timeout: 5000,
            headers
          });
        } catch (error) {
          console.warn(`Failed to notify status change for user ${this.userId}:`, error.message);
        }
      });
    }
  }

  async notifyQRCode() {
    if (this.callbackUrl && this.qrCode) {
      // Make webhook call non-blocking to prevent crashes
      setImmediate(async () => {
        try {
          const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'WhatsApp-Bot-Enhanced/1.0'
          };
          
          // Add Supabase auth if service role key is available
          if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
            headers['Authorization'] = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
          }
          
          await axios.post(this.callbackUrl, {
            type: 'qr_code',
            userId: this.userId,
            qrCode: this.qrCode,
            timestamp: new Date().toISOString()
          }, {
            timeout: 5000,
            headers
          });
        } catch (error) {
          console.warn(`Failed to notify QR code for user ${this.userId}:`, error.message);
        }
      });
    }
  }

  async getQRCode() {
    return this.qrCode;
  }

  hasQRCode() {
    return !!this.qrCode;
  }

  getStatus() {
    return this.status;
  }

  isConnected() {
    return this.connected && this.browser && !this.browser.process()?.killed;
  }

  async disconnect() {
    console.log(`Disconnecting WhatsApp bot for user ${this.userId}...`);
    
    this.connected = false;
    this.status = 'disconnected';
    
    if (this.messageCheckInterval) {
      clearInterval(this.messageCheckInterval);
    }
    
    if (this.page) {
      await this.page.close().catch(() => {});
    }
    
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }

    // Clean up QR code file
    if (fs.existsSync(this.qrCodePath)) {
      fs.unlinkSync(this.qrCodePath);
    }

    await this.notifyStatusChange();
  }
}

module.exports = WhatsAppBot;