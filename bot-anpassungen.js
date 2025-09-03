// ANPASSUNGEN FÜR DEINEN WHATSAPP-BOT.JS

class WhatsAppBot {
  constructor(userId) { // User ID hinzufügen
    this.userId = userId;
    this.browser = null;
    this.page = null;
    this.connected = false;
    this.sessionPath = `./sessions/session-${userId}`; // User-spezifische Sessions
    this.webhookUrl = process.env.SUPABASE_WEBHOOK_URL || 'https://lljgqhptjpkcuimlzvab.supabase.co/functions/v1/whatsapp-webhook';
    this.processedMessages = new Set();
    this.qrCode = null;
    this.status = 'disconnected';
  }

  // QR-Code an Supabase senden
  async sendQRToSupabase(qrCodeData) {
    try {
      const payload = {
        type: 'qr_code',
        userId: this.userId,
        qr_code: qrCodeData,
        timestamp: new Date().toISOString()
      };

      await axios.post(this.webhookUrl, payload);
      console.log('QR code sent to Supabase');
    } catch (error) {
      console.error('Failed to send QR to Supabase:', error.message);
    }
  }

  // Status-Updates an Supabase senden
  async sendStatusToSupabase(status) {
    try {
      const payload = {
        type: 'status_update',
        userId: this.userId,
        status: status,
        timestamp: new Date().toISOString()
      };

      await axios.post(this.webhookUrl, payload);
      console.log('Status sent to Supabase:', status);
    } catch (error) {
      console.error('Failed to send status to Supabase:', error.message);
    }
  }

  // waitForConnection anpassen
  async waitForConnection() {
    console.log('Waiting for WhatsApp connection...');
    
    while (true) {
      try {
        // QR Code prüfen und senden
        const qrCode = await this.page.$('[data-ref]');
        if (qrCode) {
          // QR als Base64 extrahieren
          const qrBase64 = await qrCode.evaluate(el => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            // QR Code in Base64 konvertieren
            return canvas.toDataURL();
          });
          
          this.qrCode = qrBase64;
          this.status = 'qr_ready';
          await this.sendQRToSupabase(qrBase64);
        }
        
        // Verbindung prüfen
        const chatList = await this.page.$('[data-testid="chat-list"]');
        if (chatList) {
          this.status = 'connected';
          this.connected = true;
          await this.sendStatusToSupabase('connected');
          await this.saveSession();
          return true;
        }
        
        await this.page.waitForTimeout(2000);
      } catch (error) {
        continue;
      }
    }
  }

  // Link-Detection an Supabase senden
  async dispatchLink(link, sender, messageText, groupName = null) {
    try {
      const payload = {
        type: 'link_detected',
        userId: this.userId,
        link: link,
        sender: sender,
        message: messageText,
        group_name: groupName,
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(this.webhookUrl, payload);
      console.log('Link dispatched to Supabase successfully');
    } catch (error) {
      console.error('Failed to dispatch link to Supabase:', error.message);
    }
  }

  // Getter für Status und QR
  getStatus() {
    return this.status;
  }

  getQRCode() {
    return this.qrCode;
  }
}