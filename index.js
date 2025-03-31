/**
 * FY'S INVESTMENT BOT
 *
 * FEATURES:
 *  • Displays the WhatsApp QR code on a simple Express webpage.
 *  • Provides engaging, emoji-filled responses for every operation.
 *  • Ensures that a phone number can only be registered once.
 *  • Admin commands include:
 *       - admin addbalance <phone> <amount>
 *       - admin deductbalance <phone> <amount>
 *       - admin unban <phone>
 *       - admin ban user <phone> <reason>
 *       - admin approve withdrawal <WD-ID>
 *  • When users are banned, they receive a beautiful message including the ban reason.
 *  • When a withdrawal is approved, the user is notified in a rich, engaging way.
 *  • Users can check their deposit status with an interesting, descriptive response.
 *
 * NOTES:
 *  • Replace BOT_PHONE with your bot’s number (digits only; e.g. "254700363422").
 *  • Super Admin is fixed at +254701339573.
 */

const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');

// -----------------------------------
// CONFIG & GLOBALS
// -----------------------------------

// The bot’s own WhatsApp number (digits only, no plus sign).
const BOT_PHONE = '254700363422'; 
const SUPER_ADMIN = '254701339573'; // Super Admin number

// Start with Super Admin in admin list.
let admins = [SUPER_ADMIN];

// User database file (JSON)
const USERS_FILE = path.join(__dirname, 'users.json');
// In-memory sessions for conversation state.
let sessions = {};

// Load users or initialize new object.
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

// Helper: Kenya date/time in a friendly format.
function getKenyaTime() {
  return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// Helper: generate a random string.
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

// Check if a chat belongs to an admin.
function isAdmin(chatId) {
  let cleanId = chatId.replace(/\D/g, '');
  return admins.includes(cleanId);
}

// Notify all admins with a beautifully styled message.
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
          <p>Waiting for the magic to happen... please wait as we generate your WhatsApp QR code! 🤖✨</p>
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
// WHATSAPP CLIENT
// -----------------------------------
// Pass Puppeteer flags to help launch Chromium in container environments.
const client = new Client({
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});
client.on('qr', (qr) => {
  console.log('🔐 New QR code generated. Open the web URL to view it.');
  lastQr = qr;
});
client.on('ready', async () => {
  console.log(`✅ Client is ready! [${getKenyaTime()}]`);
  const superAdminWID = `${SUPER_ADMIN}@c.us`;
  try {
    await client.sendMessage(
      superAdminWID,
      `🎉 Hello Super Admin!\nFY'S INVESTMENT BOT is now online and ready to serve! [${getKenyaTime()}]`
    );
  } catch (error) {
    console.error('❌ Error sending message to Super Admin:', error);
  }
});

// -----------------------------------
// MESSAGE HANDLER
// -----------------------------------
client.on('message_create', async (message) => {
  // Ignore messages sent by the bot.
  if (message.fromMe) return;

  const chatId = message.from;
  const msgBody = message.body.trim();
  console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

  // Deposit status check: "DP status <DEP-ID>"
  if (/^dp status /i.test(msgBody)) {
    await handleDepositStatusRequest(message);
    return;
  }
  // Navigation: "00" shows main menu.
  if (msgBody === '00') {
    await message.reply(`🏠 *Main Menu*\nPlease select an option below:`);
    await message.reply(mainMenuText());
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    return;
  }
  // Navigation: "0" cancels current operation.
  if (msgBody === '0') {
    await message.reply(`🔙 Operation cancelled. Type "00" to return to the Main Menu.`);
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    return;
  }
  // Admin commands.
  if (msgBody.toLowerCase().startsWith('admin') && isAdmin(chatId)) {
    await processAdminCommand(message);
    return;
  }
  // Registration / user session.
  let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!sessions[chatId]) {
    sessions[chatId] = { state: registeredUser ? 'awaiting_menu_selection' : 'start' };
  }
  let session = sessions[chatId];

  // If already registered, check for banned status.
  if (registeredUser) {
    if (registeredUser.banned) {
      let banMsg = `💔 You have been banned from using FY'S INVESTMENT BOT.\nReason: ${registeredUser.bannedReason || 'No reason specified.'}\nPlease contact support if you believe this is an error.`;
      await message.reply(banMsg);
      return;
    }
    await handleUserSession(message, session, registeredUser);
  } else {
    await handleRegistration(message, session);
  }
});

// -----------------------------------
// DEPOSIT STATUS HANDLER
// -----------------------------------
async function handleDepositStatusRequest(message) {
  const chatId = message.from;
  const msgBody = message.body.trim();
  const parts = msgBody.split(' ');
  if (parts.length < 3) {
    await message.reply(`❓ Please specify your deposit ID. For example: *DP status DEP-ABCDEFGH*`);
    return;
  }
  const depositID = parts.slice(2).join(' ');
  let user = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!user) {
    await message.reply(`😕 You are not registered yet. Kindly register first before checking deposit status.`);
    return;
  }
  let deposit = user.deposits.find(d => d.depositID.toLowerCase() === depositID.toLowerCase());
  if (!deposit) {
    await message.reply(`❌ Oops! No deposit found with ID: *${depositID}*.\nPlease double-check the ID and try again.`);
    return;
  }
  await message.reply(
    `📝 *Deposit Status Report*\n\n` +
    `• **Deposit ID:** ${deposit.depositID}\n` +
    `• **Amount:** Ksh ${deposit.amount}\n` +
    `• **Date:** ${deposit.date}\n` +
    `• **Status:** ${deposit.status}\n\n` +
    `Thank you for choosing FY'S Investment Bot! Type "00" to return to the Main Menu. 😊`
  );
}

// -----------------------------------
// REGISTRATION HANDLER
// -----------------------------------
async function handleRegistration(message, session) {
  const chatId = message.from;
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'start':
      await message.reply(
        `👋 Welcome to *FY'S INVESTMENT BOT*!\n\n` +
        `Please enter your *first name* to embark on your investment journey.`
      );
      session.state = 'awaiting_first_name';
      break;
    case 'awaiting_first_name':
      session.firstName = msgBody;
      setTimeout(async () => {
        await message.reply(`✨ Great, *${session.firstName}*!\nNow, kindly provide your *second name*:`);
        session.state = 'awaiting_second_name';
      }, 1500);
      break;
    case 'awaiting_second_name':
      session.secondName = msgBody;
      await message.reply(
        `🙏 Thank you, *${session.firstName} ${session.secondName}*!\n` +
        `If you have a *referral code*, please type it now; otherwise, type *NONE*.`
      );
      session.state = 'awaiting_referral_code';
      break;
    case 'awaiting_referral_code': {
      const code = msgBody.toUpperCase();
      if (code !== 'NONE') {
        let referrer = Object.values(users).find(u => u.referralCode === code);
        if (referrer) {
          session.referredBy = referrer.whatsAppId;
          await message.reply(`👍 Referral code accepted! Now, please enter your phone number (starting with 070 or 01, exactly 10 digits).`);
        } else {
          await message.reply(`⚠️ Referral code not found. We'll continue without a referral code. Please enter your phone number (e.g. 070XXXXXXXX).`);
        }
      } else {
        await message.reply(`No referral code entered.\nPlease enter your phone number (starting with 070 or 01, exactly 10 digits).`);
      }
      session.state = 'awaiting_phone';
      break;
    }
    case 'awaiting_phone':
      // Check if the phone number is in the correct format.
      if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
        await message.reply(`❌ Invalid format! Your number must start with 07 or 01 and be exactly 10 digits.\nPlease re-enter your phone number. 📞`);
      } else if (users[msgBody]) {
        // If this phone number is already registered.
        await message.reply(`😮 It seems this number is already registered with FY'S Investment Bot!\nIf you forgot your details, please contact support. ✉️`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.phone = msgBody;
        await message.reply(`🔒 Now, please create a *4-digit PIN* for secure withdrawals (from referral earnings).`);
        session.state = 'awaiting_withdrawal_pin';
      }
      break;
    case 'awaiting_withdrawal_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Oops! Please enter a valid *4-digit* PIN. 🔢`);
      } else {
        session.withdrawalPIN = msgBody;
        await message.reply(`Almost there! Create a *4-digit security PIN* (used for session timeout security). 🔐`);
        session.state = 'awaiting_security_pin';
      }
      break;
    case 'awaiting_security_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN! Kindly enter a 4-digit security PIN. 🔢`);
      } else {
        session.securityPIN = msgBody;
        // Create and save the new user.
        const newUser = {
          whatsAppId: chatId,
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
          `✅ Registration successful, *${newUser.firstName}*!\n` +
          `Your unique referral code is: *${newUser.referralCode}*.\n` +
          `Welcome aboard and let the journey to prosperity begin! 🚀\n` +
          `Type "00" to return to the Main Menu.`
        );
        sessions[chatId] = { state: 'awaiting_menu_selection' };
      }
      break;
    default:
      await message.reply(`😕 Something went awry. Let’s start over.\nType "00" for the Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

// -----------------------------------
// USER SESSION HANDLER
// -----------------------------------
async function handleUserSession(message, session, user) {
  const chatId = message.from;
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_menu_selection':
      switch (msgBody) {
        case '1': // Invest
          session.state = 'invest';
          await message.reply(`💰 Please enter the *investment amount* (minimum Ksh 1,000 and maximum Ksh 150,000):`);
          break;
        case '2': // Check Balance
          session.state = 'check_balance_menu';
          await message.reply(
            `🔍 *Balance Options:*\n` +
            `1. Account Balance\n` +
            `2. Referral Earnings\n` +
            `3. Investment History\n` +
            `Reply with 1, 2, or 3, as per your choice.`
          );
          break;
        case '3': // Withdraw
          session.state = 'withdraw';
          await message.reply(`💸 Enter the amount to withdraw from your referral earnings (minimum Ksh 1,000):`);
          break;
        case '4': // Deposit
          session.state = 'deposit';
          await message.reply(`💵 Please enter the deposit amount:`);
          break;
        case '5': // Change PIN
          session.state = 'change_pin';
          await message.reply(`🔑 Kindly enter your current 4-digit PIN to change it:`);
          break;
        case '6': // My Referral Link
          {
            const referralLink = `https://wa.me/${BOT_PHONE}?text=REF${encodeURIComponent(user.referralCode)}`;
            await message.reply(
              `🔗 *Your Exclusive Referral Link:*\n` +
              `${referralLink}\n` +
              `Share this link with friends to earn exciting referral bonuses!\n` +
              `Type "00" to return to the Main Menu.`
            );
            session.state = 'awaiting_menu_selection';
          }
          break;
        default:
          await message.reply(`❓ Oops! That option is not recognized. Please type a valid option number.`);
          break;
      }
      break;
    case 'invest': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount < 1000 || amount > 150000) {
        await message.reply(`❌ Please enter an amount between Ksh 1,000 and Ksh 150,000.`);
      } else if (user.accountBalance < amount) {
        await message.reply(`⚠️ Insufficient funds in your account (Ksh ${user.accountBalance}). Please deposit funds to continue. Type "00" for Main Menu.`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.investAmount = amount;
        session.state = 'confirm_investment';
        await message.reply(`🔒 To confirm your investment of Ksh ${amount}, please enter your 4-digit PIN:`);
      }
      break;
    }
    case 'confirm_investment':
      if (msgBody !== user.withdrawalPIN) {
        await message.reply(`❌ The PIN entered is incorrect. Please try again or type "0" to cancel.`);
      } else {
        user.accountBalance -= session.investAmount;
        let investment = {
          amount: session.investAmount,
          date: getKenyaTime(),
          expectedReturn: (session.investAmount * 0.10).toFixed(2),
          status: 'active'
        };
        user.investments.push(investment);
        // Process referral bonus if applicable.
        if (user.investments.length === 1 && user.referredBy) {
          let referrer = Object.values(users).find(u => u.whatsAppId === user.referredBy);
          if (referrer) {
            let bonus = session.investAmount * 0.03;
            referrer.referralEarnings += bonus;
            referrer.referrals.push(user.phone);
            console.log(`📢 [${getKenyaTime()}] Referral bonus: ${referrer.firstName} earned Ksh ${bonus.toFixed(2)} from ${user.firstName}'s investment.`);
          }
        }
        saveUsers();
        await message.reply(
          `✅ Your investment of Ksh ${session.investAmount} has been confirmed!\n` +
          `Expected Return: Ksh ${investment.expectedReturn}\n` +
          `Date: ${getKenyaTime()}\n\n` +
          `Thank you for investing with us! Type "00" to return to the Main Menu.`
        );
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(
          `🔔 *Investment Alert:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nInvested: Ksh ${session.investAmount}\nDate: ${getKenyaTime()}`
        );
      }
      break;
    case 'check_balance_menu':
      switch (msgBody) {
        case '1':
          await message.reply(`💳 *Account Balance:*\nYour current balance is Ksh ${user.accountBalance}.\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          session.state = 'awaiting_menu_selection';
          break;
        case '2':
          await message.reply(`🎉 *Referral Earnings:*\nYou have earned Ksh ${user.referralEarnings} from your referrals.\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          session.state = 'awaiting_menu_selection';
          break;
        case '3':
          if (user.investments.length === 0) {
            await message.reply(`📄 *Investment History:*\nNo investments have been made yet.\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          } else {
            let history = user.investments.map((inv, i) =>
              `${i + 1}. Amount: Ksh ${inv.amount}, Expected Return: Ksh ${inv.expectedReturn}, Date: ${inv.date}, Status: ${inv.status}`
            ).join('\n');
            await message.reply(`📊 *Your Investment History:*\n${history}\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        default:
          await message.reply(`❓ Please reply with 1, 2, or 3.`);
          break;
      }
      break;
    case 'withdraw': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount < 1000) {
        await message.reply(`❌ Minimum withdrawal amount is Ksh 1,000. Please enter a valid amount.`);
      } else if (user.referralEarnings < amount) {
        await message.reply(`⚠️ You only have Ksh ${user.referralEarnings} in referral earnings.\nType "00" for Main Menu.`);
        session.state = 'awaiting_menu_selection';
      } else {
        user.referralEarnings -= amount;
        let wd = {
          amount: amount,
          date: getKenyaTime(),
          withdrawalID: generateWithdrawalID(),
          status: 'pending'
        };
        user.withdrawals.push(wd);
        saveUsers();
        await message.reply(
          `💸 Withdrawal Request Received!\nWithdrawal ID: ${wd.withdrawalID}\nAmount: Ksh ${amount}\nStatus: Under review\n[${getKenyaTime()}]\nType "00" for Main Menu.`
        );
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(
          `🔔 *Withdrawal Request:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${amount}\nWithdrawal ID: ${wd.withdrawalID}\n[${getKenyaTime()}]`
        );
      }
      break;
    }
    case 'deposit': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount <= 0) {
        await message.reply(`❌ Please enter a valid deposit amount.`);
      } else {
        let dep = {
          amount: amount,
          date: getKenyaTime(),
          depositID: generateDepositID(),
          status: 'under review'
        };
        user.deposits.push(dep);
        saveUsers();
        await message.reply(
          `💵 *Deposit Request Received!*\nDeposit ID: ${dep.depositID}\nAmount: Ksh ${amount}\nPlease make your payment to M-Pesa 0701339573 (Name: Camlus Okoth).\nStatus: Under review\n[${getKenyaTime()}]\nType "00" for Main Menu.`
        );
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(
          `🔔 *Deposit Request:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${amount}\nDeposit ID: ${dep.depositID}\n[${getKenyaTime()}]`
        );
      }
      break;
    }
    case 'change_pin':
      if (msgBody !== user.withdrawalPIN) {
        await message.reply(`❌ Incorrect PIN. Please try again or type "0" to cancel.`);
      } else {
        session.state = 'new_pin';
        await message.reply(`🔑 Please enter your new 4-digit PIN:`);
      }
      break;
    case 'new_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN! Kindly enter a 4-digit PIN.`);
      } else {
        user.withdrawalPIN = msgBody;
        saveUsers();
        await message.reply(`✅ Your PIN has been changed successfully!\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
        session.state = 'awaiting_menu_selection';
      }
      break;
    default:
      await message.reply(`😕 Unrecognized state. Type "00" to return to the Main Menu.`);
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

  // admin CMD: show available admin commands.
  if (command === 'cmd') {
    await message.reply(
      `⚙️ *ADMIN COMMANDS:*\n\n` +
      `1. admin CMD\n   - Show this list.\n` +
      `2. admin view users\n   - List all registered users.\n` +
      `3. admin view investments\n   - List all investments.\n` +
      `4. admin view deposits\n   - List all deposits.\n` +
      `5. admin approve deposit <DEP-ID>\n   - Approve a deposit.\n` +
      `6. admin reject deposit <DEP-ID> <Reason>\n   - Reject a deposit with a reason.\n` +
      `7. admin approve withdrawal <WD-ID>\n   - Approve a withdrawal.\n` +
      `8. admin reject withdrawal <WD-ID> <Reason>\n   - Reject a withdrawal with a reason.\n` +
      `9. admin ban user <phone> <Reason>\n   - Ban a user by phone with a reason.\n` +
      `10. admin add admin <phone>\n   - Add a new admin (Super Admin only).\n` +
      `11. admin addbalance <phone> <amount>\n   - Add funds to a user’s account.\n` +
      `12. admin deductbalance <phone> <amount>\n   - Deduct funds from a user’s account.\n` +
      `13. admin unban <phone>\n   - Unban a user.\n` +
      `[${getKenyaTime()}]`
    );
    return;
  }

  // View commands.
  if (command === 'view' && subCommand === 'users') {
    let userList = Object.values(users)
      .map(u => `${u.firstName} ${u.secondName} (Phone: ${u.phone})`)
      .join('\n');
    if (!userList) userList = 'No registered users found.';
    await message.reply(`📋 *User List:*\n\n${userList}\n\n[${getKenyaTime()}]`);
    return;
  }
  if (command === 'view' && subCommand === 'investments') {
    let investmentsList = '';
    for (let key in users) {
      let u = users[key];
      u.investments.forEach((inv, idx) => {
        investmentsList += `${u.firstName} ${u.secondName} - Investment ${idx + 1}: Ksh ${inv.amount}, Status: ${inv.status}\n`;
      });
    }
    if (!investmentsList) investmentsList = 'No investments found.';
    await message.reply(`📊 *Investments:*\n\n${investmentsList}\n[${getKenyaTime()}]`);
    return;
  }
  if (command === 'view' && subCommand === 'deposits') {
    let depositsList = '';
    for (let key in users) {
      let u = users[key];
      u.deposits.forEach((dep, idx) => {
        depositsList += `${u.firstName} ${u.secondName} - Deposit ${idx + 1}: ID: ${dep.depositID}, Amount: Ksh ${dep.amount}, Status: ${dep.status}\n`;
      });
    }
    if (!depositsList) depositsList = 'No deposits found.';
    await message.reply(`💰 *Deposits:*\n\n${depositsList}\n[${getKenyaTime()}]`);
    return;
  }
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
          // Inform the user that their withdrawal has been approved.
          client.sendMessage(u.whatsAppId, `🎉 Congratulations ${u.firstName}! Your withdrawal request (ID: ${wd.withdrawalID}) for Ksh ${wd.amount} has been approved. Thank you for trusting FY'S Investment Bot!`);
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
  if (command === 'add' && subCommand === 'admin') {
    if (chatId.replace(/\D/g, '') !== SUPER_ADMIN) {
      await message.reply(`🚫 Only the Super Admin can add new admins.`);
      return;
    }
    let newAdminPhone = msgParts[3]?.replace(/\D/g, '');
    if (!newAdminPhone) {
      await message.reply(`Usage: admin add admin <phone>`);
      return;
    }
    if (!admins.includes(newAdminPhone)) {
      admins.push(newAdminPhone);
      await message.reply(`✅ ${newAdminPhone} added as an admin successfully.`);
    } else {
      await message.reply(`ℹ️ ${newAdminPhone} is already an admin.`);
    }
    return;
  }
  if (command === 'addbalance') {
    let phone = msgParts[2];
    let amount = parseFloat(msgParts[3]);
    if (!phone || isNaN(amount)) {
      await message.reply(`Usage: admin addbalance <phone> <amount>`);
      return;
    }
    if (!users[phone]) {
      await message.reply(`User with phone ${phone} not found.`);
      return;
    }
    users[phone].accountBalance += amount;
    saveUsers();
    await message.reply(`✅ Added Ksh ${amount} to user ${phone}. New balance: Ksh ${users[phone].accountBalance}`);
    const userWID = users[phone].whatsAppId;
    try {
      await client.sendMessage(userWID, `💰 Your account has been credited with Ksh ${amount}. New balance: Ksh ${users[phone].accountBalance}`);
    } catch (error) {
      console.error(`❌ Error notifying user ${phone}:`, error);
    }
    return;
  }
  if (command === 'deductbalance') {
    let phone = msgParts[2];
    let amount = parseFloat(msgParts[3]);
    if (!phone || isNaN(amount)) {
      await message.reply(`Usage: admin deductbalance <phone> <amount>`);
      return;
    }
    if (!users[phone]) {
      await message.reply(`User with phone ${phone} not found.`);
      return;
    }
    users[phone].accountBalance = Math.max(0, users[phone].accountBalance - amount);
    saveUsers();
    await message.reply(`✅ Deducted Ksh ${amount} from user ${phone}. New balance: Ksh ${users[phone].accountBalance}`);
    const userWID = users[phone].whatsAppId;
    try {
      await client.sendMessage(userWID, `⚠️ Ksh ${amount} has been deducted from your account. New balance: Ksh ${users[phone].accountBalance}`);
    } catch (error) {
      console.error(`❌ Error notifying user ${phone}:`, error);
    }
    return;
  }
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
    const userWID = users[phone].whatsAppId;
    try {
      await client.sendMessage(userWID, `😊 You have been unbanned from FY'S INVESTMENT BOT. Welcome back!`);
    } catch (error) {
      console.error(`❌ Error notifying user ${phone}:`, error);
    }
    return;
  }
  await message.reply(`❓ Unrecognized admin command. Please type "admin CMD" to view available commands.\n[${getKenyaTime()}]`);
}

// -----------------------------------
// MAIN MENU HELPER
// -----------------------------------
function mainMenuText() {
  return (
    `🌟 *FY'S INVESTMENT BOT Main Menu* 🌟\n` +
    `Please choose from the following options:\n` +
    `1. Invest 💰\n` +
    `2. Check Balance 🔍\n` +
    `3. Withdraw Earnings 💸\n` +
    `4. Deposit Funds 💵\n` +
    `5. Change PIN 🔑\n` +
    `6. My Referral Link 🔗\n\n` +
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
// Use the Replit-provided port or default to 3000.
const PORT = process.env.PORT || 3000;
// Automatically detect Replit domain if available.
const replSlug = process.env.REPL_SLUG;
const replOwner = process.env.REPL_OWNER;
let domain = 'localhost';
if (replSlug && replOwner) {
  domain = `${replSlug}.${replOwner}.repl.co`;
}
app.listen(PORT, () => {
  const url = (domain === 'localhost') ? `http://localhost:${PORT}` : `https://${domain}`;
  console.log(`🚀 Express server running on port ${PORT}. Visit ${url} to view the QR code.`);
});
