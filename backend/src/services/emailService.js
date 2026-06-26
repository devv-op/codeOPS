const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

class EmailService {
  constructor() {
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = process.env.SMTP_PORT || '587';
    const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
    const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort),
      secure: smtpPort === '465',
      auth: smtpUser && smtpPass ? {
        user: smtpUser,
        pass: smtpPass
      } : undefined
    });

    this.isConfigured = !!(smtpUser && smtpPass);

    if (this.isConfigured) {
      this.transporter.verify((error, success) => {
        if (error) {
          console.warn('⚠️ SMTP Connection Verification Failed:', error.message);
          this.isConfigured = false;
        } else {
          console.log('✅ SMTP Server is ready to take messages');
        }
      });
    } else {
      console.warn('⚠️ SMTP credentials not fully configured. Emails will be logged to the console.');
    }
  }

  async sendEmail(to, subject, templateName, context) {
    try {
      const templatePath = path.join(__dirname, '../emails', `${templateName}.hbs`);
      const templateSource = fs.readFileSync(templatePath, 'utf8');
      const template = handlebars.compile(templateSource);
      const html = template(context);

      const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.EMAIL_USER || 'no-reply@codeops.com';
      const mailOptions = {
        from: `"CodeOps" <${fromEmail}>`,
        to,
        subject,
        html,
        text: this.htmlToText(html)
      };

      if (!this.isConfigured) {
        throw new Error('SMTP credentials not configured');
      }

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`Email sent: ${info.messageId}`);
      return info;
    } catch (error) {
      console.warn(`\n⚠️  Email delivery to ${to} failed: ${error.message}`);
      
      // If this is an OTP template, print the OTP code to the console for easy development access
      if (context && context.otp) {
        console.log('\n==================================================');
        console.log('🔑 [LOCAL DEV] OTP Verification Code:');
        console.log(`   To:    ${to}`);
        console.log(`   Code:  ${context.otp}`);
        console.log('==================================================\n');
      } else if (context && context.resetUrl) {
        console.log('\n==================================================');
        console.log('🔑 [LOCAL DEV] Password Reset Link:');
        console.log(`   To:   ${to}`);
        console.log(`   Link: ${context.resetUrl}`);
        console.log('==================================================\n');
      } else {
        console.log('\n==================================================');
        console.log(`📧 [LOCAL DEV] Email to ${to}:`);
        console.log(`   Subject: ${subject}`);
        console.log(`   Context:`, JSON.stringify(context, null, 2));
        console.log('==================================================\n');
      }
      
      // Return a mock response so the calling request doesn't fail
      return { messageId: 'local-dev-mock-id' };
    }
  }

  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async sendOTP(email, otp, name) {
    return this.sendEmail(email, 'Your OTP Code - InterviewPrep Pro', 'otp', {
      name,
      otp,
      expiryMinutes: 10,
      supportEmail: process.env.SUPPORT_EMAIL
    });
  }

  async sendWelcomeEmail(email, name) {
    return this.sendEmail(email, 'Welcome to InterviewPrep Pro!', 'welcome', {
      name,
      loginUrl: `${process.env.FRONTEND_URL}/login`,
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
      supportEmail: process.env.SUPPORT_EMAIL
    });
  }

  async sendPasswordResetEmail(email, name, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    return this.sendEmail(email, 'Password Reset Request', 'password-reset', {
      name,
      resetUrl,
      expiryHours: 1,
      supportEmail: process.env.SUPPORT_EMAIL
    });
  }

  async sendPasswordChangedEmail(email, name) {
    return this.sendEmail(email, 'Password Changed Successfully', 'password-changed', {
      name,
      loginUrl: `${process.env.FRONTEND_URL}/login`,
      supportEmail: process.env.SUPPORT_EMAIL
    });
  }
}

module.exports = new EmailService();