const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class WhatsAppBot {
  constructor(userId, options = {}) {
    this.userId = userId;
    this.connected = false;
    this.status = 'disconnected';
    this.webhookUrl = options.webhookUrl;
    this.callbackUrl = options.callbackUrl;
    this.processedMessages = new Set();
    this.qrCode = null;
    this.qrCodeDataURL = null;
    
    // Create WhatsApp Web client
    this.client = new Client({
      authStrategy: new LocalAuth({ 
        clientId: userId,
        dataPath: './sessions'
      }),
      puppeteer: {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process'
        ]
      }
    });
    
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // QR Code event - non-blocking!
    this.client.on('qr', async (qr) => {
      console.log(`QR Code received for user ${this.userId}`);
      await this.handleQRCode(qr);
    });

    // Ready event - connection established
    this.client.on('ready', async () => {
      console.log(`Client is ready for user ${this.userId}!`);
      await this.handleReady();
    });

    // Message event - for link detection
    this.client.on('message', async (message) => {
      await this.handleMessage(message);
    });

    // Disconnection event
    this.client.on('disconnected', async (reason) => {
      console.log(`Client disconnected for user ${this.userId}:`, reason);
      await this.handleDisconnected(reason);
    });

    // Authentication failure
    this.client.on('auth_failure', async (msg) => {
      console.error(`Authentication failed for user ${this.userId}:`, msg);
      this.status = 'auth_failed';
      await this.notifyStatusChange();
    });
  }

  async initialize() {
    try {
      console.log(`Initializing WhatsApp client for user ${this.userId}...`);
      
      this.status = 'initializing';
      await this.notifyStatusChange();

      // Start the WhatsApp client - this will trigger events
      await this.client.initialize();
      
      console.log(`WhatsApp client initialization started for user ${this.userId}`);
      
    } catch (error) {
      console.error(`Failed to initialize WhatsApp client for user ${this.userId}:`, error);
      this.status = 'error';
      await this.notifyStatusChange();
      throw error;
    }
  }

  async handleQRCode(qr) {
    try {
      console.log(`Generating QR code for user ${this.userId}`);
      
      // Store raw QR string
      this.qrCode = qr;
      
      // Generate QR code as data URL for display
      this.qrCodeDataURL = await qrcode.toDataURL(qr, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        quality: 0.92,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      this.status = 'qr_ready';
      await this.notifyStatusChange();
      await this.notifyQRCode();
      
      console.log(`QR code generated and ready for user ${this.userId}`);
      
    } catch (error) {
      console.error(`Failed to generate QR code for user ${this.userId}:`, error);
    }
  }

  async handleReady() {
    try {
      this.status = 'connected';
      this.connected = true;
      this.qrCode = null; // Clear QR code once connected
      this.qrCodeDataURL = null;
      
      await this.notifyStatusChange();
      
      console.log(`WhatsApp client ready and connected for user ${this.userId}`);
      
    } catch (error) {
      console.error(`Error handling ready state for user ${this.userId}:`, error);
    }
  }

  async handleMessage(message) {
    try {
      // Skip if message is from status broadcast
      if (message.from === 'status@broadcast') return;
      
      // Extract message content
      const messageBody = message.body || '';
      const messageId = message.id.id;
      
      // Skip if already processed
      if (this.processedMessages.has(messageId)) return;
      this.processedMessages.add(messageId);
      
      // Extract links from message
      const links = this.extractLinks(messageBody);
      
      if (links.length > 0) {
        console.log(`Found ${links.length} links in message from user ${this.userId}`);
        
        // Get contact info
        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || contact.number || 'Unknown';
        
        // Dispatch each link
        for (const link of links) {
          await this.dispatchLink(link, senderName, messageBody);
        }
      }
      
    } catch (error) {
      console.error(`Error handling message for user ${this.userId}:`, error);
    }
  }

  async handleDisconnected(reason) {
    try {
      this.status = 'disconnected';
      this.connected = false;
      this.qrCode = null;
      this.qrCodeDataURL = null;
      
      await this.notifyStatusChange();
      
      console.log(`WhatsApp client disconnected for user ${this.userId}. Reason:`, reason);
      
    } catch (error) {
      console.error(`Error handling disconnection for user ${this.userId}:`, error);
    }
  }

  extractLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
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

        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Bot-Enhanced/1.0'
        };
        
        // Add optional webhook authentication
        if (process.env.WEBHOOK_SECRET) {
          headers['Authorization'] = `Bearer ${process.env.WEBHOOK_SECRET}`;
        }

        const response = await axios.post(this.webhookUrl, payload, {
          timeout: 10000,
          headers
        });

        console.log(`Link dispatched to user webhook successfully for ${this.userId}`);
      }

      // Also send to callback URL if configured
      if (this.callbackUrl) {
        const callbackPayload = {
          type: 'link_detected',
          userId: this.userId,
          link: link,
          sender: sender,
          message: messageText,
          timestamp: new Date().toISOString()
        };

        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Bot-Enhanced/1.0'
        };
        
        // Add Supabase auth if service role key is available
        if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
          headers['Authorization'] = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
        }

        await axios.post(this.callbackUrl, callbackPayload, {
          timeout: 5000,
          headers
        });
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
    if (this.callbackUrl && this.qrCodeDataURL) {
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
            qrCode: this.qrCodeDataURL,
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
    return this.qrCodeDataURL;
  }

  // Get clean base64 QR code without data URL prefix
  getCleanBase64QR() {
    if (!this.qrCodeDataURL) return null;
    
    // Remove data URL prefix if present
    return this.qrCodeDataURL.replace(/^data:image\/png;base64,/, '');
  }

  // Get QR code as data URL (for direct browser display)
  getQRCodeDataURL() {
    return this.qrCodeDataURL;
  }

  hasQRCode() {
    return !!this.qrCodeDataURL;
  }

  getStatus() {
    return this.status;
  }

  isConnected() {
    return this.connected;
  }

  async disconnect() {
    try {
      console.log(`Disconnecting WhatsApp client for user ${this.userId}...`);
      
      if (this.client) {
        await this.client.destroy();
      }
      
      this.connected = false;
      this.status = 'disconnected';
      this.qrCode = null;
      this.qrCodeDataURL = null;
      
      console.log(`WhatsApp client disconnected for user ${this.userId}`);
      
    } catch (error) {
      console.error(`Error disconnecting WhatsApp client for user ${this.userId}:`, error);
    }
  }
}

module.exports = WhatsAppBot;