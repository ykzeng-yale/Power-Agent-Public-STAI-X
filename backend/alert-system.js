/**
 * Alert System for Power Agent
 * Handles email and Slack notifications for critical issues
 */

import dotenv from 'dotenv';

dotenv.config();

/**
 * Send Slack notification
 * @param {string} severity - Alert severity (CRITICAL, WARNING, INFO)
 * @param {string} message - Alert message
 */
export async function sendSlackAlert(severity, message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('Slack webhook not configured');
    return false;
  }

  const color = severity === 'CRITICAL' ? '#FF0000' :
                 severity === 'WARNING' ? '#FFA500' : '#00FF00';

  const payload = {
    attachments: [{
      color: color,
      title: `Power Agent Alert - ${severity}`,
      text: message,
      timestamp: Math.floor(Date.now() / 1000),
      footer: 'Power Agent Monitoring System'
    }]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Slack notification failed:', response.statusText);
      return false;
    }

    console.log('✅ Slack notification sent');
    return true;
  } catch (error) {
    console.error('Error sending Slack notification:', error);
    return false;
  }
}

/**
 * Send email notification using SMTP
 * @param {string} severity - Alert severity
 * @param {string} message - Alert message
 */
export async function sendEmailAlert(severity, message) {
  // Check if email configuration exists
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('Email configuration not found in environment variables');
    return false;
  }

  try {
    // Dynamic import to avoid loading if not configured
    const nodemailer = await import('nodemailer');

    const transporter = nodemailer.default.createTransporter({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.ALERT_EMAIL_TO,
      subject: `[${severity}] Power Agent Alert`,
      text: message,
      html: `
        <h2>Power Agent Alert</h2>
        <p><strong>Severity:</strong> ${severity}</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <hr>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <hr>
        <p><small>This is an automated message from Power Agent Monitoring System</small></p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email notification sent:', info.messageId);
    return true;

  } catch (error) {
    console.error('Error sending email notification:', error);
    return false;
  }
}

/**
 * Send alert through all configured channels
 * @param {string} severity - Alert severity
 * @param {string} message - Alert message
 * @param {Object} options - Additional options
 */
export async function sendAlert(severity, message, options = {}) {
  const { forceEmail = false, forceSlack = false } = options;

  // Log to console always
  console.log(`\n🚨 ALERT [${severity}] at ${new Date().toISOString()}`);
  console.log(`   ${message}\n`);

  const promises = [];

  // Only send critical alerts or if forced
  if (severity === 'CRITICAL' || forceSlack) {
    promises.push(sendSlackAlert(severity, message));
  }

  if (severity === 'CRITICAL' || forceEmail) {
    promises.push(sendEmailAlert(severity, message));
  }

  await Promise.all(promises);
}

/**
 * Test alert system
 */
export async function testAlertSystem() {
  console.log('Testing alert system...');

  await sendAlert('INFO', 'This is a test alert from Power Agent monitoring system', {
    forceEmail: true,
    forceSlack: true
  });

  console.log('Test alert sent. Check your email and Slack.');
}

// Export for use in other modules
export default {
  sendAlert,
  sendSlackAlert,
  sendEmailAlert,
  testAlertSystem
};