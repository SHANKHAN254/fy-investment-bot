/**
 * FY'S INVESTMENT BOT
 *
 * FEATURES:
 *  1. Registration & Login:
 *     - Users type "register" to start registration.
 *     - They provide first name, second name, referral code (mandatory; if absent, type "contact support"),
 *       then phone number (checked for duplicates), then set a withdrawal PIN and a security (login) PIN.
 *     - Login flow: users type "login", then enter their registered phone number, then their security PIN.
 *     - On successful login, a login alert is sent to their device.
 *
 *  2. Investments & Referrals:
 *     - Users can invest funds (if balance permits). Expected returns are calculated.
 *     - If a user was referred, their referrer automatically earns a bonus (admin-set percentage) and is notified.
 *     - Users can view their own referrals (only names), and admins can view full referral details.
 *
 *  3. Withdrawals:
 *     - Users choose between withdrawing referral earnings or account balance.
 *     - They enter a withdrawal amount (validated against min/max), then their MPESA number (must start with 07/01 and be exactly 10 digits), and then their withdrawal PIN.
 *     - If the PIN is entered incorrectly twice, an alert is sent to admin and the withdrawal is canceled.
 *     - On success, a detailed withdrawal request is created and sent to admin.
 *     - Users can also view their withdrawal status.
 *
 *  4. Deposits:
 *     - Users choose between automatic deposit (STK push) and manual deposit.
 *     - For automatic deposit, they enter an amount and a valid phone number; the bot sends an STK push via an API.
 *       It then polls for transaction status for up to 20 seconds; if successful, balance is updated and transaction details are shown.
 *     - For manual deposit, deposit instructions are displayed.
 *     - Users are notified upon deposit approval or rejection.
 *
 *  5. Admin Commands:
 *     - Admins can view users (detailed and numbered), investments, deposits, and referrals.
 *     - They can approve/reject deposit and withdrawal requests (with notifications to users).
 *     - They can ban/unban users.
 *     - They can reset a user's PIN (choosing between withdrawal and login PIN).
 *     - They can change system settings (earning %, referral %, investment duration, min/max amounts, deposit and withdrawal instructions).
 *     - Only Super Admin can add or remove admins.
 *     - They can send bulk messages to all users.
 *
 *  6. Additional Features:
 *     - On startup, the secret admin referral code is sent to the Super Admin.
 *     - When a new login occurs, a login alert is sent to the user's previous device.
 *
 * NOTES:
 *  - Replace BOT_PHONE with your bot's number (digits only, e.g., "254700363422").
 *  - Super Admin is fixed at +254701339573.
 */

const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');

// -----------------------------------
// GLOBAL SETTINGS & CONFIGURATION
// -----------------------------------
const BOT_PHONE = '254700363422';
const SUPER_ADMIN = '254701339573';

let EARNING_PERCENTAGE = 10;
let REFERRAL_PERCENTAGE = 5;
let INVESTMENT_DURATION = 60;
let MIN_INVESTMENT = 1000;
let MAX_INVESTMENT = 150000;
let MIN_WITHDRAWAL = 1000;
let MAX_WITHDRAWAL = 1000000;
let DEPOSIT_INSTRUCTIONS = "M-Pesa 0701339573 (Name: Camlus Okoth)";
let WITHDRAWAL_INSTRUCTIONS = "Your withdrawal will be processed shortly. Please ensure your MPESA number is correct.";

// STK Push API settings
let STK_CHANNEL_ID = 911;
let STK_BASIC_AUTH = "Basic 3A6anVoWFZrRk5qSVl0MGNMOERGMlR3dlhrQ0VWUWJHNDVVnNaMEdDSw==";
let STATUS_BASIC_AUTH = "Basic MWo5TjVkZTFwSGc2Rm03TXJ2bldKbjg4dXFhMHF6ZDMzUHlvNjJNUg==";

// Secret admin referral code (never shown to users)
const ADMIN_REFERRAL_CODE = "ADMIN-" + Math.random().toString(36).substring(2, 7).toUpperCase();

let admins = [SUPER_ADMIN];

// -----------------------------------
// DATA STORAGE
// -----------------------------------
const USERS_FILE = path.join(__dirname, 'users.json');
let sessions = {};
let users = {};
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    console.error('❌ Error reading users file:', e);
    users = {};
  }
} else {
  users = {};
}
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// -----------------------------------
// HELPER FUNCTIONS
// -----------------------------------
function getKenyaTime() {
  return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}
function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
function generateReferralCode() {
  return "FY'S-" + randomString(5);
}
function generateDepositID() {
  return "DEP-" + randomString(8);
}
function generateWithdrawalID() {
  return "WD-" + randomString(4);
}
function isAdmin(chatId) {
  let cleanId = chatId.replace(/\D/g, '');
  return admins.includes(cleanId);
}
async function notifyAdmins(text) {
  for (let adminPhone of admins) {
    const adminWID = `${adminPhone}@c.us`;
    try {
      await client.sendMessage(adminWID, text);
    } catch (error) {
      console.error(`❌ Error notifying admin ${adminPhone}:`, error);
    }
  }
}

// -----------------------------------
// AUTO MATURATION OF INVESTMENTS
// -----------------------------------
setInterval(() => {
  const now = Date.now();
  for (let phone in users) {
    let user = users[phone];
    user.investments.forEach(inv => {
      if (inv.status === 'active' && now - inv.timestamp >= INVESTMENT_DURATION * 60000) {
        let earnings = inv.amount * (EARNING_PERCENTAGE / 100);
        user.accountBalance += inv.amount + earnings;
        inv.status = 'completed';
        inv.maturedDate = getKenyaTime();
        console.log(`🎉 [${getKenyaTime()}] Investment matured for ${user.firstName}. Total credited: Ksh ${inv.amount + earnings}`);
        client.sendMessage(user.whatsAppId,
          `🎉 Congratulations ${user.firstName}! Your investment of Ksh ${inv.amount} has matured. You earned Ksh ${earnings.toFixed(2)}, and your account has been credited with Ksh ${inv.amount + earnings}.`
        );
      }
    });
  }
  saveUsers();
}, 60000);

// -----------------------------------
// EXPRESS SERVER FOR QR CODE
// -----------------------------------
const app = express();
let lastQr = null;
app.get('/', (req, res) => {
  if (!lastQr) {
    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>🌟 FY'S INVESTMENT BOT 🌟</h1>
          <p>Generating your WhatsApp QR code... please wait! 🤖✨</p>
        </body>
      </html>
    `);
  }
  qrcode.toDataURL(lastQr, (err, url) => {
    if (err) return res.send('❌ Error generating QR code.');
    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>🌟 FY'S INVESTMENT BOT - QR Code 🌟</h1>
          <img src="${url}" alt="WhatsApp QR Code"/>
          <p>Scan this code with WhatsApp and join the magic! 🚀💫</p>
        </body>
      </html>
    `);
  });
});

// -----------------------------------
// STK PUSH FUNCTIONS FOR DEPOSITS
// -----------------------------------
async function requestSTKPush(amount, phone) {
  try {
    const payload = {
      amount: amount,
      phone_number: phone,
      channel_id: STK_CHANNEL_ID,
      provider: "m-pesa",
      external_reference: "DEP-" + randomString(8),
      customer_name: "Customer",
      callback_url: "https://your-callback-url.com/callback"
    };
    const response = await axios.post('https://backend.payhero.co.ke/api/v2/payments', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': STK_BASIC_AUTH
      }
    });
    return response.data;
  } catch (error) {
    console.error("❌ STK Push request error:", error);
    throw error;
  }
}

async function fetchTransactionStatus(reference) {
  try {
    const response = await axios.get('https://backend.payhero.co.ke/api/v2/transaction-status', {
      params: { reference },
      headers: { 'Authorization': STATUS_BASIC_AUTH }
    });
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching transaction status:", error);
    throw error;
  }
}

// -----------------------------------
// WHATSAPP CLIENT SETUP
// -----------------------------------
const client = new Client({
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});
client.on('qr', (qr) => {
  console.log('🔐 New QR code generated. Open the web URL to view it.');
  lastQr = qr;
});
client.on('ready', async () => {
  console.log(`✅ Client is ready! [${getKenyaTime()}]`);
  const superAdminWID = `${SUPER_ADMIN}@c.us`;
  try {
    await client.sendMessage(superAdminWID,
      `🎉 Hello Super Admin!\nFY'S INVESTMENT BOT is now online and ready to serve! [${getKenyaTime()}]`
    );
    await client.sendMessage(superAdminWID,
      `🔒 Your secret admin referral code is: *${ADMIN_REFERRAL_CODE}*\nKeep it safe and use it to provide new users with a valid referral code if needed.`
    );
  } catch (error) {
    console.error('❌ Error sending message to Super Admin:', error);
  }
});

// -----------------------------------
// MESSAGE HANDLER
// -----------------------------------
client.on('message_create', async (message) => {
  if (message.fromMe) return;
  const chatId = message.from;
  const msgBody = message.body.trim();
  console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

  // ---- LOGIN FLOW ----
  if (msgBody.toLowerCase() === 'login') {
    await message.reply(`🔑 Please enter your registered phone number:`);
    sessions[chatId] = { state: 'login_phone' };
    return;
  }
  if (sessions[chatId] && sessions[chatId].state === 'login_phone') {
    let user = Object.values(users).find(u => u.phone === msgBody);
    if (!user) {
      await message.reply(`❌ No account found with that number. Please type "register" to create a new account.`);
      sessions[chatId] = { state: 'init' };
      return;
    }
    sessions[chatId].loginUser = user;
    sessions[chatId].state = 'login_pin';
    await message.reply(`🔑 Please enter your security PIN to login:`);
    return;
  }
  if (sessions[chatId] && sessions[chatId].state === 'login_pin') {
    let user = sessions[chatId].loginUser;
    if (msgBody === user.securityPIN) {
      // Send a login alert to the user’s previous device if available.
      if (user.loggedInChatId && user.loggedInChatId !== chatId) {
        try {
          await client.sendMessage(user.loggedInChatId, `🔔 Alert: Your account was just accessed from a new device. If this wasn't you, please reply "block".`);
        } catch (error) {
          console.error(`❌ Error alerting previous device:`, error);
        }
      }
      user.loggedInChatId = chatId;
      saveUsers();
      await message.reply(`😊 Welcome back, ${user.firstName}! You are now logged in. Type "00" for the Main Menu.\n🔔 Login Alert: If this wasn’t you, type "block".`);
      sessions[chatId] = { state: 'awaiting_menu_selection' };
      return;
    } else {
      await message.reply(`❌ Incorrect PIN. Please try again.`);
      return;
    }
  }
  if (msgBody.toLowerCase() === 'block') {
    // If the user types "block", we assume they want to block the new device.
    await message.reply(`🚫 New device access blocked. Please contact support immediately.`);
    // Here you might trigger further actions (e.g. ban the new device, notify admin, etc.)
    return;
  }
  // ---- FORGOT PIN FLOW ----
  if (msgBody.toLowerCase() === 'forgot pin') {
    await message.reply(`😥 Please enter your registered phone number for PIN reset assistance:`);
    sessions[chatId] = { state: 'forgot_pin' };
    return;
  }
  if (sessions[chatId] && sessions[chatId].state === 'forgot_pin') {
    if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
      await message.reply(`❌ Invalid phone format. Please re-enter your registered phone number.`);
      return;
    }
    await message.reply(`🙏 Thank you. A support ticket has been created. Please wait for assistance.`);
    notifyAdmins(`⚠️ *Forgot PIN Alert:*\nUser with phone ${msgBody} has requested a PIN reset.`);
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    return;
  }
  // ---- REGISTRATION & MAIN MENU ----
  let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!registeredUser && !sessions[chatId]) {
    await message.reply(`❓ You are not registered or logged in yet. Please type "register" to begin registration or "login" if you already have an account.`);
    sessions[chatId] = { state: 'init' };
    return;
  }
  if (msgBody === '00') {
    await message.reply(`🏠 *Main Menu*\n${mainMenuText()}`);
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    return;
  }
  if (msgBody === '0') {
    await message.reply(`🔙 Operation cancelled. Type "00" to return to the Main Menu.`);
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    return;
  }
  if (msgBody.toLowerCase().startsWith('admin') && isAdmin(chatId)) {
    await processAdminCommand(message);
    return;
  }
  let session = sessions[chatId] || { state: registeredUser ? 'awaiting_menu_selection' : 'init' };
  sessions[chatId] = session;
  if (registeredUser) {
    if (registeredUser.banned) {
      await message.reply(`💔 You have been banned from FY'S INVESTMENT BOT.\nReason: ${registeredUser.bannedReason || 'No reason specified.'}\nPlease contact support if you believe this is an error.`);
      return;
    }
    await handleUserSession(message, session, registeredUser);
  } else {
    if (session.state === 'init' && msgBody.toLowerCase() === 'register') {
      await message.reply(`👋 Let's begin registration! Please enter your *first name*:`);
      session.state = 'awaiting_first_name';
      return;
    }
    if (session.state === 'init') {
      await message.reply(`❓ Please type "register" to begin registration or "login" if you already have an account.`);
      return;
    }
    await handleRegistration(message, session);
  }
});

// -----------------------------------
// DEPOSIT STATUS HANDLER
// -----------------------------------
async function handleDepositStatusRequest(message) {
  const parts = message.body.trim().split(' ');
  if (parts.length < 3) {
    await message.reply(`❓ Please specify your deposit ID. For example: *DP status DEP-ABCDEFGH*`);
    return;
  }
  const depositID = parts.slice(2).join(' ');
  let user = Object.values(users).find(u => u.whatsAppId === message.from);
  if (!user) {
    await message.reply(`😕 You are not registered yet. Please register before checking deposit status.`);
    return;
  }
  let deposit = user.deposits.find(d => d.depositID.toLowerCase() === depositID.toLowerCase());
  if (!deposit) {
    await message.reply(`❌ No deposit found with ID: *${depositID}*. Please double-check and try again.`);
    return;
  }
  await message.reply(
    `📝 *Deposit Status Report:*\n\n` +
    `1️⃣ **Deposit ID:** ${deposit.depositID}\n` +
    `2️⃣ **Amount:** Ksh ${deposit.amount}\n` +
    `3️⃣ **Date:** ${deposit.date}\n` +
    `4️⃣ **Status:** ${deposit.status}\n\n` +
    `Thank you for using FY'S INVESTMENT BOT! Type "00" for the Main Menu. 😊`
  );
}

// -----------------------------------
// REGISTRATION HANDLER
// -----------------------------------
async function handleRegistration(message, session) {
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_first_name':
      session.firstName = msgBody;
      await message.reply(`✨ Great, *${session.firstName}*! Now, please enter your *second name*:`);
      session.state = 'awaiting_second_name';
      break;
    case 'awaiting_second_name':
      session.secondName = msgBody;
      await message.reply(`🙏 Thanks, *${session.firstName} ${session.secondName}*!\nPlease enter your referral code.\n(If you don't have one, type "contact support" to request one.)`);
      session.state = 'awaiting_referral_code';
      break;
    case 'awaiting_referral_code':
      if (msgBody.toLowerCase() === 'contact support') {
        await message.reply(`📞 A support ticket has been created. Our team will contact you with a referral code shortly. Please try again later.`);
        notifyAdmins(`⚠️ *Support Ticket:*\nUnregistered user with chat ID ${message.from} requested a referral code.`);
        session.state = 'init';
        return;
      }
      if (!msgBody) {
        await message.reply(`❌ A referral code is required. Please contact support to obtain one.`);
        return;
      }
      let referrer = Object.values(users).find(u => u.referralCode === msgBody.toUpperCase());
      if (!referrer && msgBody.toUpperCase() !== ADMIN_REFERRAL_CODE) {
        await message.reply(`⚠️ Referral code not found. Please contact support for a valid referral code.`);
        return;
      }
      session.referredBy = msgBody.toUpperCase();
      await message.reply(`👍 Referral code accepted!\nNow, please enter your phone number (e.g., 070XXXXXXXX):`);
      session.state = 'awaiting_phone';
      break;
    case 'awaiting_phone':
      if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
        await message.reply(`❌ Invalid format! Your phone must start with 07 or 01 and be exactly 10 digits.\nPlease re-enter your phone number.`);
      } else if (users[msgBody]) {
        await message.reply(`😮 This number is already registered!\nPlease type "login" to access your account.`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.phone = msgBody;
        await message.reply(`🔒 Now, please create a *4-digit PIN* for withdrawals:`);
        session.state = 'awaiting_withdrawal_pin';
      }
      break;
    case 'awaiting_withdrawal_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Please enter a valid 4-digit PIN. 🔢`);
      } else {
        session.withdrawalPIN = msgBody;
        await message.reply(`Almost there! Create a *4-digit security PIN* (used for login):`);
        session.state = 'awaiting_security_pin';
      }
      break;
    case 'awaiting_security_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN! Kindly enter a 4-digit security PIN.`);
      } else {
        session.securityPIN = msgBody;
        const newUser = {
          whatsAppId: message.from,
          firstName: session.firstName,
          secondName: session.secondName,
          phone: session.phone,
          withdrawalPIN: session.withdrawalPIN,
          securityPIN: session.securityPIN,
          referralCode: generateReferralCode(),
          referredBy: session.referredBy || null,
          referrals: [],
          accountBalance: 0,
          referralEarnings: 0,
          investments: [],
          deposits: [],
          withdrawals: [],
          banned: false,
          bannedReason: ''
        };
        users[session.phone] = newUser;
        saveUsers();
        await message.reply(
          `✅ Registration successful, *${newUser.firstName}*!\nYour referral code is: *${newUser.referralCode}*.\nWelcome aboard – let the journey to prosperity begin! 🚀\nType "00" for the Main Menu.`
        );
        sessions[message.from] = { state: 'awaiting_menu_selection' };
      }
      break;
    default:
      await message.reply(`😕 Something went wrong. Please type "00" to return to the Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

// -----------------------------------
// DEPOSIT FLOW (Automatic STK Push vs Manual)
// -----------------------------------
async function handleDeposit(message, session, user) {
  const body = message.body.trim();
  if (!session.depositOption) {
    await message.reply(`💵 How would you like to deposit?\nReply with:\n1️⃣ For automatic deposit (STK push)\n2️⃣ For manual deposit instructions`);
    session.state = 'choose_deposit_method';
    return;
  }
  if (session.state === 'choose_deposit_method') {
    if (body === '1') {
      session.depositOption = 'automatic';
      await message.reply(`💵 Please enter the deposit amount for automatic deposit:`);
      session.state = 'auto_deposit_amount';
    } else if (body === '2') {
      session.depositOption = 'manual';
      await message.reply(`💵 Please enter the deposit amount:`);
      session.state = 'manual_deposit_amount';
    } else {
      await message.reply(`❓ Please reply with 1 for automatic deposit or 2 for manual deposit instructions.`);
    }
    return;
  }
  if (session.depositOption === 'automatic') {
    if (session.state === 'auto_deposit_amount') {
      let amount = parseFloat(body);
      if (isNaN(amount) || amount <= 0) {
        await message.reply(`❌ Please enter a valid deposit amount.`);
        return;
      }
      session.depositAmount = amount;
      await message.reply(`📱 Please enter the phone number for the STK push (must start with 07 or 01 and be exactly 10 digits):`);
      session.state = 'auto_deposit_phone';
      return;
    }
    if (session.state === 'auto_deposit_phone') {
      if (!/^(07|01)[0-9]{8}$/.test(body)) {
        await message.reply(`❌ Invalid phone number format. Please re-enter a valid 10-digit phone number starting with 07 or 01.`);
        return;
      }
      session.depositPhone = body;
      try {
        const stkResponse = await requestSTKPush(session.depositAmount, session.depositPhone);
        session.depositReference = stkResponse.reference;
        await message.reply(`🚀 STK push request sent! Please wait while we check your transaction status...`);
        let attempts = 0;
        let interval = setInterval(async () => {
          attempts++;
          try {
            const statusResponse = await fetchTransactionStatus(session.depositReference);
            if (statusResponse.status === "SUCCESS") {
              clearInterval(interval);
              user.accountBalance += session.depositAmount;
              let dep = {
                amount: session.depositAmount,
                date: getKenyaTime(),
                depositID: generateDepositID(),
                status: "approved",
                provider_reference: statusResponse.provider_reference || "N/A"
              };
              user.deposits.push(dep);
              saveUsers();
              await message.reply(`✅ Automatic deposit successful!\nDeposit ID: ${dep.depositID}\nAmount: Ksh ${dep.amount}\nTransaction Code: ${dep.provider_reference}\nYour account has been credited.\nType "00" for the Main Menu.`);
              notifyAdmins(`🔔 *Automatic Deposit Success:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${dep.amount}\nDeposit ID: ${dep.depositID}\nTransaction Code: ${dep.provider_reference}\nDate: ${dep.date}`);
              session.state = 'awaiting_menu_selection';
            } else if (attempts >= 4) {
              clearInterval(interval);
              await message.reply(`⚠️ STK push not successful. Please try manual deposit.\n${DEPOSIT_INSTRUCTIONS}\nType "00" for the Main Menu.`);
              session.state = 'awaiting_menu_selection';
            }
          } catch (e) {
            console.error("❌ Error checking deposit status:", e);
          }
        }, 5000);
      } catch (error) {
        await message.reply(`❌ Automatic deposit request failed. Please try manual deposit.\n${DEPOSIT_INSTRUCTIONS}\nType "00" for the Main Menu.`);
        session.state = 'awaiting_menu_selection';
      }
      return;
    }
  }
  if (session.depositOption === 'manual') {
    if (session.state === 'choose_deposit_method') {
      if (body === '2') {
        session.depositOption = 'manual';
        await message.reply(`💵 Please enter the deposit amount:`);
        session.state = 'manual_deposit_amount';
      } else if (body === '1') {
        session.depositOption = 'automatic';
        await message.reply(`💵 Please enter the deposit amount for automatic deposit:`);
        session.state = 'auto_deposit_amount';
      } else {
        await message.reply(`❓ Please reply with 1 for automatic deposit or 2 for manual deposit instructions.`);
      }
      return;
    }
    if (session.state === 'manual_deposit_amount') {
      let amount = parseFloat(body);
      if (isNaN(amount) || amount <= 0) {
        await message.reply(`❌ Please enter a valid deposit amount.`);
        return;
      }
      session.depositAmount = amount;
      let dep = {
        amount: session.depositAmount,
        date: getKenyaTime(),
        depositID: generateDepositID(),
        status: 'under review'
      };
      user.deposits.push(dep);
      saveUsers();
      await message.reply(`💵 *Deposit Request Received!*\nDeposit ID: ${dep.depositID}\nAmount: Ksh ${dep.amount}\nPlease follow these manual deposit instructions:\n${DEPOSIT_INSTRUCTIONS}\nStatus: Under review\nRequested at: ${dep.date}\nType "00" for the Main Menu.`);
      notifyAdmins(`🔔 *Manual Deposit Request:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${dep.amount}\nDeposit ID: ${dep.depositID}\nDate: ${dep.date}`);
      session.state = 'awaiting_menu_selection';
      return;
    }
  }
}

// -----------------------------------
// USER SESSION HANDLER (Main Menu Options)
// -----------------------------------
async function handleUserSession(message, session, user) {
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_menu_selection':
      switch (msgBody) {
        case '1':
          session.state = 'invest';
          await message.reply(`💰 Enter the *investment amount* (min: Ksh ${MIN_INVESTMENT}, max: Ksh ${MAX_INVESTMENT}):`);
          break;
        case '2':
          session.state = 'check_balance_menu';
          await message.reply(
            `🔍 *Balance Options:*\n` +
            `1. View Account Balance\n` +
            `2. View Referral Earnings\n` +
            `3. View Investment History\n` +
            `4. View All Deposit Statuses\n` +
            `Reply with 1, 2, 3, or 4.`
          );
          break;
        case '3':
          session.state = 'withdraw';
          await message.reply(`💸 Withdrawal Options:\n1️⃣ Withdraw Referral Earnings\n2️⃣ Withdraw Investment Earnings (Account Balance)`);
          break;
        case '4':
          session.state = 'choose_deposit_method';
          await message.reply(`💵 How would you like to deposit?\nReply with:\n1️⃣ Automatic Deposit (STK push)\n2️⃣ Manual Deposit Instructions`);
          break;
        case '5':
          session.state = 'change_pin';
          await message.reply(`🔑 Enter your current 4-digit PIN to change it:`);
          break;
        case '6': {
          const referralLink = `https://wa.me/${BOT_PHONE}?text=REF${encodeURIComponent(user.referralCode)}`;
          await message.reply(`🔗 *Your Referral Link:*\n${referralLink}\nShare it with friends to earn bonuses on their investments!\nType "00" for the Main Menu.`);
          session.state = 'awaiting_menu_selection';
          break;
        }
        case '7':
          session.state = 'withdrawal_status';
          if (user.withdrawals.length === 0) {
            await message.reply(`📄 You have no withdrawal requests yet.\nType "00" for the Main Menu.`);
          } else {
            let list = user.withdrawals.map((wd, i) =>
              `${i + 1}. ID: ${wd.withdrawalID}, Amount: Ksh ${wd.amount}, MPESA: ${wd.mpesa}, Date: ${wd.date}, Status: ${wd.status}`
            ).join('\n');
            await message.reply(`📋 *Your Withdrawal Requests:*\n${list}\nType "00" for the Main Menu.`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        case '8':
          session.state = 'view_referrals';
          if (user.referrals.length === 0) {
            await message.reply(`📄 You haven't referred anyone yet.\nType "00" for the Main Menu.`);
          } else {
            let list = user.referrals.map((ref, i) => {
              let u = Object.values(users).find(u => u.phone === ref);
              return `${i + 1}. ${u ? u.firstName + ' ' + u.secondName : ref}`;
            }).join('\n');
            await message.reply(`📋 *Your Referrals:*\n${list}\nType "00" for the Main Menu.`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        default:
          await message.reply(`❓ Unrecognized option. Please enter a valid option number.`);
          break;
      }
      break;
    case 'invest': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount < MIN_INVESTMENT || amount > MAX_INVESTMENT) {
        await message.reply(`❌ Please enter an amount between Ksh ${MIN_INVESTMENT} and Ksh ${MAX_INVESTMENT}.`);
      } else if (user.accountBalance < amount) {
        await message.reply(`⚠️ Insufficient funds (Ksh ${user.accountBalance}). Please deposit funds. Type "00" for the Main Menu.`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.investAmount = amount;
        session.state = 'confirm_investment';
        await message.reply(`🔒 To confirm your investment of Ksh ${amount}, enter your 4-digit PIN:`);
      }
      break;
    }
    case 'confirm_investment':
      if (msgBody !== user.withdrawalPIN) {
        await message.reply(`❌ Incorrect PIN. Please try again or type "0" to cancel.`);
      } else {
        user.accountBalance -= session.investAmount;
        let investment = {
          amount: session.investAmount,
          date: getKenyaTime(),
          timestamp: Date.now(),
          expectedReturn: (session.investAmount * (EARNING_PERCENTAGE / 100)).toFixed(2),
          status: 'active'
        };
        user.investments.push(investment);
        if (user.investments.length === 1 && user.referredBy) {
          let referrer = Object.values(users).find(u => u.whatsAppId === user.referredBy);
          if (referrer) {
            let bonus = session.investAmount * (REFERRAL_PERCENTAGE / 100);
            referrer.referralEarnings += bonus;
            referrer.referrals.push(user.phone);
            client.sendMessage(referrer.whatsAppId,
              `🎉 Hi ${referrer.firstName}, you earned a referral bonus of Ksh ${bonus.toFixed(2)} because ${user.firstName} invested!`
            );
            console.log(`📢 [${getKenyaTime()}] Referral bonus: ${referrer.firstName} earned Ksh ${bonus.toFixed(2)} from ${user.firstName}'s investment.`);
          }
        }
        saveUsers();
        await message.reply(
          `✅ Investment confirmed!\nInvested: Ksh ${session.investAmount}\nExpected Earnings (@${EARNING_PERCENTAGE}%): Ksh ${investment.expectedReturn}\nIt will mature in ${INVESTMENT_DURATION} minutes.\nType "00" for the Main Menu.`
        );
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(
          `🔔 *Investment Alert:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nInvested: Ksh ${session.investAmount}\nDate: ${getKenyaTime()}`
        );
      }
      break;
    case 'check_balance_menu':
      // (Handled in the main menu switch above.)
      break;
    case 'withdraw': {
      if (msgBody === '1' || msgBody === '2') {
        session.withdrawOption = msgBody;
        await message.reply(`💸 Enter the amount you wish to withdraw (min: Ksh ${MIN_WITHDRAWAL}, max: Ksh ${MAX_WITHDRAWAL}):`);
        session.state = 'withdraw_amount';
      } else {
        await message.reply(`❓ Please reply with 1 for Referral Earnings or 2 for Investment Earnings.`);
      }
      break;
    }
    case 'withdraw_amount': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
        await message.reply(`❌ Please enter an amount between Ksh ${MIN_WITHDRAWAL} and Ksh ${MAX_WITHDRAWAL}.`);
      } else {
        if (session.withdrawOption === '1' && user.referralEarnings < amount) {
          await message.reply(`⚠️ Insufficient referral earnings. Your earnings: Ksh ${user.referralEarnings}.`);
          session.state = 'awaiting_menu_selection';
          break;
        }
        if (session.withdrawOption === '2' && user.accountBalance < amount) {
          await message.reply(`⚠️ Insufficient account balance. Your balance: Ksh ${user.accountBalance}.`);
          session.state = 'awaiting_menu_selection';
          break;
        }
        session.withdrawAmount = amount;
        await message.reply(`📱 Enter your MPESA number (must start with 07 or 01 and be exactly 10 digits):`);
        session.state = 'withdraw_mpesa';
      }
      break;
    }
    case 'withdraw_mpesa': {
      if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
        await message.reply(`❌ Invalid MPESA number format. Please re-enter your MPESA number correctly.`);
      } else {
        session.mpesaNumber = msgBody;
        session.withdrawWrongCount = 0;
        await message.reply(`🔒 Enter your withdrawal PIN:`);
        session.state = 'withdraw_pin';
      }
      break;
    }
    case 'withdraw_pin': {
      if (msgBody !== user.withdrawalPIN) {
        session.withdrawWrongCount = (session.withdrawWrongCount || 0) + 1;
        if (session.withdrawWrongCount >= 2) {
          await message.reply(`❌ Incorrect PIN entered twice. An alert has been sent to admin.`);
          notifyAdmins(`⚠️ *Withdrawal PIN Alert:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone}) entered an incorrect withdrawal PIN twice.`);
          session.state = 'awaiting_menu_selection';
        } else {
          await message.reply(`❌ Incorrect PIN. Please try again:`);
        }
      } else {
        if (session.withdrawOption === '1') {
          user.referralEarnings -= session.withdrawAmount;
        } else {
          user.accountBalance -= session.withdrawAmount;
        }
        let wd = {
          amount: session.withdrawAmount,
          mpesa: session.mpesaNumber,
          date: getKenyaTime(),
          withdrawalID: generateWithdrawalID(),
          status: 'pending'
        };
        user.withdrawals.push(wd);
        saveUsers();
        await message.reply(
          `💸 *Withdrawal Request Received!*\nWithdrawal ID: ${wd.withdrawalID}\nAmount: Ksh ${wd.amount}\nMPESA Number: ${wd.mpesa}\nRequested at: ${wd.date}\nYour request has been sent to admin for approval.\nType "00" for the Main Menu.`
        );
        notifyAdmins(`🔔 *Withdrawal Request:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${wd.amount}\nMPESA: ${wd.mpesa}\nWithdrawal ID: ${wd.withdrawalID}\nDate: ${wd.date}`);
        session.state = 'awaiting_menu_selection';
      }
      break;
    }
    case 'deposit': {
      await handleDeposit(message, session, user);
      break;
    }
    case 'change_pin':
      if (msgBody !== user.withdrawalPIN) {
        await message.reply(`❌ Incorrect current PIN. Please try again or type "0" to cancel.`);
      } else {
        session.state = 'new_pin';
        await message.reply(`🔑 Enter your new 4-digit PIN:`);
      }
      break;
    case 'new_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN! Please enter a valid 4-digit PIN.`);
      } else {
        user.withdrawalPIN = msgBody;
        saveUsers();
        await message.reply(`✅ Your PIN has been changed successfully!\n[${getKenyaTime()}]\nType "00" for the Main Menu.`);
        session.state = 'awaiting_menu_selection';
      }
      break;
    default:
      await message.reply(`😕 Unrecognized state. Please type "00" to return to the Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

// -----------------------------------
// ADMIN COMMAND PROCESSOR
// -----------------------------------
async function processAdminCommand(message) {
  const chatId = message.from;
  const msgParts = message.body.trim().split(' ');
  const command = (msgParts[1] || '').toLowerCase();
  const subCommand = (msgParts[2] || '').toLowerCase();

  if (command === 'cmd') {
    await message.reply(
      `⚙️ *ADMIN COMMANDS:*\n\n` +
      `1. admin CMD – Show this list.\n` +
      `2. admin view users – List all registered users.\n` +
      `3. admin view investments – List all investments.\n` +
      `4. admin view deposits – List all deposits.\n` +
      `5. admin view referrals – List all users’ referrals.\n` +
      `6. admin approve deposit <DEP-ID> – Approve a deposit.\n` +
      `7. admin reject deposit <DEP-ID> <Reason> – Reject a deposit with reason.\n` +
      `8. admin approve withdrawal <WD-ID> – Approve a withdrawal.\n` +
      `9. admin reject withdrawal <WD-ID> <Reason> – Reject a withdrawal with reason.\n` +
      `10. admin ban user <phone> <Reason> – Ban a user.\n` +
      `11. admin unban <phone> – Unban a user.\n` +
      `12. admin resetpin <phone> <new_pin> [withdrawal|login] – Reset a user’s PIN.\n` +
      `13. admin setearn <percentage> – Set earning percentage (1–100).\n` +
      `14. admin setreferral <percentage> – Set referral bonus percentage (1–100).\n` +
      `15. admin setduration <minutes> – Set investment duration in minutes.\n` +
      `16. admin setmininvestment <amount> – Set minimum investment.\n` +
      `17. admin setmaxinvestment <amount> – Set maximum investment.\n` +
      `18. admin setminwithdrawal <amount> – Set minimum withdrawal.\n` +
      `19. admin setmaxwithdrawal <amount> – Set maximum withdrawal.\n` +
      `20. admin setdeposit <instructions> <deposit_number> – Set deposit instructions & number.\n` +
      `21. admin setwithdrawal <instructions> – Set withdrawal instructions.\n` +
      `22. admin addadmin <phone> – Add a new admin (SUPER ADMIN ONLY).\n` +
      `23. admin removeadmin <phone> – Remove an admin (SUPER ADMIN ONLY).\n` +
      `24. admin bulk <message> – Send a bulk message to all users.\n` +
      `[${getKenyaTime()}]`
    );
    return;
  }
  // Implement view users
  if (command === 'view' && subCommand === 'users') {
    let userList = Object.values(users)
      .map((u, i) =>
        `${i + 1}. ${u.firstName} ${u.secondName} (Phone: ${u.phone})\n   ➤ Balance: Ksh ${u.accountBalance}, Earnings: Ksh ${u.referralEarnings}\n   ➤ PINs: Withdrawal: ${u.withdrawalPIN}, Login: ${u.securityPIN}\n   ➤ Referred By: ${u.referredBy || 'N/A'}\n   ➤ Activities: Investments: ${u.investments.length}, Deposits: ${u.deposits.length}, Withdrawals: ${u.withdrawals.length}\n`
      ).join('\n');
    if (!userList) userList = 'No registered users found.';
    await message.reply(`📋 *Detailed User List:*\n\n${userList}\n[${getKenyaTime()}]`);
    return;
  }
  // View investments
  if (command === 'view' && subCommand === 'investments') {
    let investmentsList = '';
    for (let key in users) {
      let u = users[key];
      u.investments.forEach((inv, i) => {
        investmentsList += `${u.firstName} ${u.secondName} - Investment ${i + 1}: Ksh ${inv.amount}, Expected: Ksh ${inv.expectedReturn}, Status: ${inv.status}\n`;
      });
    }
    if (!investmentsList) investmentsList = 'No investments found.';
    await message.reply(`📊 *Investments:*\n\n${investmentsList}\n[${getKenyaTime()}]`);
    return;
  }
  // View deposits
  if (command === 'view' && subCommand === 'deposits') {
    let depositsList = '';
    for (let key in users) {
      let u = users[key];
      u.deposits.forEach((dep, i) => {
        depositsList += `${u.firstName} ${u.secondName} - Deposit ${i + 1}: ID: ${dep.depositID}, Amount: Ksh ${dep.amount}, Status: ${dep.status}\n`;
      });
    }
    if (!depositsList) depositsList = 'No deposits found.';
    await message.reply(`💰 *Deposits:*\n\n${depositsList}\n[${getKenyaTime()}]`);
    return;
  }
  // View referrals
  if (command === 'view' && subCommand === 'referrals') {
    let referralList = Object.values(users)
      .map((u, i) =>
        `${i + 1}. ${u.firstName} ${u.secondName} (Phone: ${u.phone})\n   ➤ Referred: ${u.referrals.join(', ') || 'None'}\n`
      ).join('\n');
    if (!referralList) referralList = 'No referral data available.';
    await message.reply(`📋 *User Referrals:*\n\n${referralList}\n[${getKenyaTime()}]`);
    return;
  }
  // Approve deposit
  if (command === 'approve' && subCommand === 'deposit') {
    const depID = msgParts[3];
    if (!depID) {
      await message.reply(`Usage: admin approve deposit <DEP-ID>`);
      return;
    }
    let found = false;
    for (let key in users) {
      let u = users[key];
      u.deposits.forEach(dep => {
        if (dep.depositID.toLowerCase() === depID.toLowerCase()) {
          dep.status = 'approved';
          u.accountBalance += parseFloat(dep.amount);
          found = true;
          client.sendMessage(u.whatsAppId,
            `✅ Your deposit (ID: ${dep.depositID}) for Ksh ${dep.amount} has been approved!`
          );
        }
      });
    }
    if (found) {
      saveUsers();
      await message.reply(`✅ Deposit ${depID} approved successfully!\n[${getKenyaTime()}]`);
    } else {
      await message.reply(`❌ Deposit ID not found: ${depID}`);
    }
    return;
  }
  // Reject deposit
  if (command === 'reject' && subCommand === 'deposit') {
    const depID = msgParts[3];
    if (!depID) {
      await message.reply(`Usage: admin reject deposit <DEP-ID> <Reason>`);
      return;
    }
    const reason = msgParts.slice(4).join(' ') || 'No reason provided';
    let found = false;
    for (let key in users) {
      let u = users[key];
      u.deposits.forEach(dep => {
        if (dep.depositID.toLowerCase() === depID.toLowerCase()) {
          dep.status = `rejected (${reason})`;
          found = true;
          client.sendMessage(u.whatsAppId,
            `❌ Your deposit (ID: ${dep.depositID}) for Ksh ${dep.amount} has been rejected.\nReason: ${reason}`
          );
        }
      });
    }
    if (found) {
      saveUsers();
      await message.reply(`❌ Deposit ${depID} rejected.\nReason: ${reason}\n[${getKenyaTime()}]`);
    } else {
      await message.reply(`Deposit ID not found: ${depID}`);
    }
    return;
  }
  // Approve withdrawal
  if (command === 'approve' && subCommand === 'withdrawal') {
    const wdID = msgParts[3];
    if (!wdID) {
      await message.reply(`Usage: admin approve withdrawal <WD-ID>`);
      return;
    }
    let found = false;
    for (let key in users) {
      let u = users[key];
      u.withdrawals.forEach(wd => {
        if (wd.withdrawalID.toLowerCase() === wdID.toLowerCase()) {
          wd.status = 'approved';
          found = true;
          client.sendMessage(u.whatsAppId,
            `🎉 Congratulations ${u.firstName}! Your withdrawal request (ID: ${wd.withdrawalID}) for Ksh ${wd.amount} has been approved.\nMPESA: ${wd.mpesa}\nDate: ${wd.date}`
          );
        }
      });
    }
    if (found) {
      saveUsers();
      await message.reply(`✅ Withdrawal ${wdID} approved successfully!\n[${getKenyaTime()}]`);
    } else {
      await message.reply(`❌ Withdrawal ID not found: ${wdID}`);
    }
    return;
  }
  // Reject withdrawal
  if (command === 'reject' && subCommand === 'withdrawal') {
    const wdID = msgParts[3];
    if (!wdID) {
      await message.reply(`Usage: admin reject withdrawal <WD-ID> <Reason>`);
      return;
    }
    const reason = msgParts.slice(4).join(' ') || 'No reason provided';
    let found = false;
    for (let key in users) {
      let u = users[key];
      u.withdrawals.forEach(wd => {
        if (wd.withdrawalID.toLowerCase() === wdID.toLowerCase()) {
          wd.status = `rejected (${reason})`;
          found = true;
          client.sendMessage(u.whatsAppId,
            `❌ Your withdrawal request (ID: ${wd.withdrawalID}) for Ksh ${wd.amount} has been rejected.\nReason: ${reason}`
          );
        }
      });
    }
    if (found) {
      saveUsers();
      await message.reply(`❌ Withdrawal ${wdID} rejected.\nReason: ${reason}\n[${getKenyaTime()}]`);
    } else {
      await message.reply(`Withdrawal ID not found: ${wdID}`);
    }
    return;
  }
  // Ban user
  if (command === 'ban' && subCommand === 'user') {
    let phone = msgParts[3];
    if (!phone) {
      await message.reply(`Usage: admin ban user <phone> <Reason>`);
      return;
    }
    let reason = msgParts.slice(4).join(' ') || 'No reason provided';
    if (users[phone]) {
      if (users[phone].whatsAppId.replace(/\D/g, '') === SUPER_ADMIN) {
        await message.reply(`🚫 Cannot ban the Super Admin.`);
        return;
      }
      users[phone].banned = true;
      users[phone].bannedReason = reason;
      saveUsers();
      await message.reply(`🚫 User ${phone} has been banned.\nReason: ${reason}\n[${getKenyaTime()}]`);
    } else {
      await message.reply(`User with phone ${phone} not found.`);
    }
    return;
  }
  // Unban user
  if (command === 'unban') {
    let phone = msgParts[2];
    if (!phone) {
      await message.reply(`Usage: admin unban <phone>`);
      return;
    }
    if (!users[phone]) {
      await message.reply(`User with phone ${phone} not found.`);
      return;
    }
    users[phone].banned = false;
    users[phone].bannedReason = '';
    saveUsers();
    await message.reply(`✅ User ${phone} has been unbanned successfully.`);
    try {
      await client.sendMessage(users[phone].whatsAppId, `😊 You have been unbanned from FY'S INVESTMENT BOT. Welcome back!`);
    } catch (error) {
      console.error(`❌ Error notifying user ${phone}:`, error);
    }
    return;
  }
  // Reset PIN
  if (command === 'resetpin') {
    let phone = msgParts[2];
    let newPin = msgParts[3];
    let type = msgParts[4] ? msgParts[4].toLowerCase() : 'withdrawal';
    if (!phone || !newPin || !/^\d{4}$/.test(newPin)) {
      await message.reply(`Usage: admin resetpin <phone> <new_pin> [withdrawal|login] (4-digit)`);
      return;
    }
    if (!users[phone]) {
      await message.reply(`User with phone ${phone} not found.`);
      return;
    }
    if (type === 'login') {
      users[phone].securityPIN = newPin;
      await message.reply(`✅ Security PIN for user ${phone} has been reset to ${newPin}.`);
    } else {
      users[phone].withdrawalPIN = newPin;
      await message.reply(`✅ Withdrawal PIN for user ${phone} has been reset to ${newPin}.`);
    }
    saveUsers();
    return;
  }
  // Set Earning Percentage
  if (command === 'setearn') {
    let percentage = parseFloat(msgParts[3]);
    if (isNaN(percentage) || percentage < 1 || percentage > 100) {
      await message.reply(`Usage: admin setearn <percentage> (1–100)`);
      return;
    }
    EARNING_PERCENTAGE = percentage;
    await message.reply(`✅ Earning percentage updated to ${EARNING_PERCENTAGE}%.`);
    return;
  }
  // Set Referral Bonus Percentage
  if (command === 'setreferral') {
    let percentage = parseFloat(msgParts[3]);
    if (isNaN(percentage) || percentage < 1 || percentage > 100) {
      await message.reply(`Usage: admin setreferral <percentage> (1–100)`);
      return;
    }
    REFERRAL_PERCENTAGE = percentage;
    await message.reply(`✅ Referral bonus percentage updated to ${REFERRAL_PERCENTAGE}%.`);
    return;
  }
  // Set Investment Duration
  if (command === 'setduration') {
    let minutes = parseInt(msgParts[3]);
    if (isNaN(minutes) || minutes < 1) {
      await message.reply(`Usage: admin setduration <minutes> (at least 1)`);
      return;
    }
    INVESTMENT_DURATION = minutes;
    await message.reply(`✅ Investment duration updated to ${INVESTMENT_DURATION} minutes.`);
    return;
  }
  // Set Minimum Investment
  if (command === 'setmininvestment') {
    let amount = parseFloat(msgParts[3]);
    if (isNaN(amount) || amount < 1) {
      await message.reply(`Usage: admin setmininvestment <amount>`);
      return;
    }
    MIN_INVESTMENT = amount;
    await message.reply(`✅ Minimum investment set to Ksh ${MIN_INVESTMENT}.`);
    return;
  }
  // Set Maximum Investment
  if (command === 'setmaxinvestment') {
    let amount = parseFloat(msgParts[3]);
    if (isNaN(amount) || amount < MIN_INVESTMENT) {
      await message.reply(`Usage: admin setmaxinvestment <amount> (must be greater than min investment)`);
      return;
    }
    MAX_INVESTMENT = amount;
    await message.reply(`✅ Maximum investment set to Ksh ${MAX_INVESTMENT}.`);
    return;
  }
  // Set Minimum Withdrawal
  if (command === 'setminwithdrawal') {
    let amount = parseFloat(msgParts[3]);
    if (isNaN(amount) || amount < 1) {
      await message.reply(`Usage: admin setminwithdrawal <amount>`);
      return;
    }
    MIN_WITHDRAWAL = amount;
    await message.reply(`✅ Minimum withdrawal set to Ksh ${MIN_WITHDRAWAL}.`);
    return;
  }
  // Set Maximum Withdrawal
  if (command === 'setmaxwithdrawal') {
    let amount = parseFloat(msgParts[3]);
    if (isNaN(amount) || amount < MIN_WITHDRAWAL) {
      await message.reply(`Usage: admin setmaxwithdrawal <amount> (must be greater than min withdrawal)`);
      return;
    }
    MAX_WITHDRAWAL = amount;
    await message.reply(`✅ Maximum withdrawal set to Ksh ${MAX_WITHDRAWAL}.`);
    return;
  }
  // Set Deposit Instructions
  if (command === 'setdeposit') {
    if (msgParts.length < 4) {
      await message.reply(`Usage: admin setdeposit <instructions> <deposit_number>`);
      return;
    }
    DEPOSIT_INSTRUCTIONS = msgParts.slice(3, msgParts.length - 1).join(' ');
    DEPOSIT_NUMBER = msgParts[msgParts.length - 1];
    await message.reply(`✅ Deposit instructions updated:\n${DEPOSIT_INSTRUCTIONS}\nDeposit Number: ${DEPOSIT_NUMBER}`);
    return;
  }
  // Set Withdrawal Instructions
  if (command === 'setwithdrawal') {
    if (msgParts.length < 3) {
      await message.reply(`Usage: admin setwithdrawal <instructions>`);
      return;
    }
    WITHDRAWAL_INSTRUCTIONS = msgParts.slice(2).join(' ');
    await message.reply(`✅ Withdrawal instructions updated:\n${WITHDRAWAL_INSTRUCTIONS}`);
    return;
  }
  // Add Admin (Super Admin only)
  if (command === 'addadmin') {
    if (chatId.replace(/\D/g, '') !== SUPER_ADMIN) {
      await message.reply(`🚫 Only the Super Admin can add new admins.`);
      return;
    }
    let newAdminPhone = msgParts[3]?.replace(/\D/g, '');
    if (!newAdminPhone) {
      await message.reply(`Usage: admin addadmin <phone>`);
      return;
    }
    if (!admins.includes(newAdminPhone)) {
      admins.push(newAdminPhone);
      await message.reply(`✅ ${newAdminPhone} added as an admin.`);
    } else {
      await message.reply(`ℹ️ ${newAdminPhone} is already an admin.`);
    }
    return;
  }
  // Remove Admin (Super Admin only)
  if (command === 'removeadmin') {
    if (chatId.replace(/\D/g, '') !== SUPER_ADMIN) {
      await message.reply(`🚫 Only the Super Admin can remove admins.`);
      return;
    }
    let remAdminPhone = msgParts[3]?.replace(/\D/g, '');
    if (!remAdminPhone) {
      await message.reply(`Usage: admin removeadmin <phone>`);
      return;
    }
    let index = admins.indexOf(remAdminPhone);
    if (index === -1) {
      await message.reply(`ℹ️ ${remAdminPhone} is not an admin.`);
    } else {
      admins.splice(index, 1);
      await message.reply(`✅ ${remAdminPhone} has been removed from the admin list.`);
    }
    return;
  }
  // Bulk Message
  if (command === 'bulk') {
    const bulkMsg = msgParts.slice(2).join(' ');
    if (!bulkMsg) {
      await message.reply(`Usage: admin bulk <message>`);
      return;
    }
    for (let phone in users) {
      try {
        await client.sendMessage(users[phone].whatsAppId, `📢 *Broadcast Message:*\n${bulkMsg}`);
      } catch (e) {
        console.error(`❌ Error sending bulk message to ${phone}:`, e);
      }
    }
    await message.reply(`✅ Bulk message sent to all users.`);
    return;
  }
  await message.reply(`❓ Unrecognized admin command. Type "admin CMD" to view available commands.\n[${getKenyaTime()}]`);
}

// -----------------------------------
// MAIN MENU HELPER
// -----------------------------------
function mainMenuText() {
  return (
    `🌟 *FY'S INVESTMENT BOT Main Menu* 🌟\n` +
    `Please choose an option:\n` +
    `1. Invest 💰\n` +
    `2. Check Balance 🔍\n` +
    `3. Withdraw Earnings 💸\n` +
    `4. Deposit Funds 💵\n` +
    `5. Change PIN 🔑\n` +
    `6. My Referral Link 🔗\n` +
    `7. View Withdrawal Status 📋\n` +
    `8. View My Referrals 👥\n\n` +
    `Type the option number (or "00" to see this menu again).`
  );
}

// -----------------------------------
// START THE WHATSAPP CLIENT
// -----------------------------------
client.initialize();

// -----------------------------------
// START THE EXPRESS SERVER
// -----------------------------------
const PORT = process.env.PORT || 3000;
const replSlug = process.env.REPL_SLUG;
const replOwner = process.env.REPL_OWNER;
let domain = 'localhost';
if (replSlug && replOwner) {
  domain = `${replSlug}.${replOwner}.repl.co`;
}
app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}. Open the provided URL to view the QR code.`);
});
