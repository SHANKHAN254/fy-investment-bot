/**
 * FY'S INVESTMENT BOT
 *
 * FEATURES:
 *  • Displays the WhatsApp QR code on an Express webpage.
 *  • Provides engaging, emoji-filled responses.
 *  • Prevents duplicate registration and supports login via security PIN.
 *  • Automatically detects referral codes if a new user’s first message starts with "REF…"
 *  • When a referred user invests, the referrer earns a bonus (default 5%, configurable).
 *  • In the Balance submenu, users can now view account balance, referral earnings,
 *    investment history, or a numbered list of all deposit statuses.
 *  • When withdrawing, users choose to withdraw either referral earnings or investment earnings.
 *  • Admin commands include: viewing detailed user info, managing investments/deposits,
 *    approving/rejecting withdrawals, banning/unbanning users, resetting PINs, and more.
 *  • Super Admin (254701339573) is the only one who can add or remove admins.
 *  • Admins can send bulk messages to all users.
 *  • Configurable settings via admin commands:
 *       - Earning percentage on investments
 *       - Referral bonus percentage
 *       - Investment duration (for automatic maturity)
 *       - Minimum/maximum investment and withdrawal amounts
 *       - Deposit instructions and deposit number
 *
 * NOTES:
 *  • Replace BOT_PHONE with your bot’s number (digits only, e.g. "254700363422").
 *  • Super Admin is fixed at +254701339573.
 */

const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');

// -----------------------------------
// GLOBAL SETTINGS & CONFIGURATION
// -----------------------------------
const BOT_PHONE = '254700363422';
const SUPER_ADMIN = '254701339573';

// System settings (admin-configurable)
let EARNING_PERCENTAGE = 10;        // % earned on investment maturation
let REFERRAL_PERCENTAGE = 5;         // % bonus for referred user’s investment
let INVESTMENT_DURATION = 60;        // minutes until an investment matures
let MIN_INVESTMENT = 1000;
let MAX_INVESTMENT = 150000;
let MIN_WITHDRAWAL = 1000;
let MAX_WITHDRAWAL = 1000000;
let DEPOSIT_INSTRUCTIONS = "M-Pesa 0701339573 (Name: Camlus Okoth)";
let DEPOSIT_NUMBER = "0701339573";

// Super Admin is always in admin list.
let admins = [SUPER_ADMIN];

// -----------------------------------
// DATA STORAGE
// -----------------------------------
const USERS_FILE = path.join(__dirname, 'users.json');
let sessions = {};  // in-memory session data
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
// Check every minute for investments that have matured.
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
        console.log(`🎉 [${getKenyaTime()}] Investment matured for ${user.firstName}. Principal: Ksh ${inv.amount}, Earnings: Ksh ${earnings.toFixed(2)} credited.`);
        client.sendMessage(user.whatsAppId,
          `🎉 Congratulations ${user.firstName}! Your investment of Ksh ${inv.amount} has matured. You earned Ksh ${earnings.toFixed(2)}, and your account has been credited with a total of Ksh ${inv.amount + earnings}.`
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
// WHATSAPP CLIENT SETUP
// -----------------------------------
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
  if (message.fromMe) return;
  const chatId = message.from;
  const msgBody = message.body.trim();
  console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

  // Command: Deposit status check (e.g., "DP status DEP-ABCDEFGH")
  if (/^dp status /i.test(msgBody)) {
    await handleDepositStatusRequest(message);
    return;
  }
  // If user sends "login", begin login flow.
  if (msgBody.toLowerCase() === 'login') {
    await message.reply(`🔑 Please enter your login PIN (the security PIN you set during registration):`);
    sessions[chatId] = { state: 'login' };
    return;
  }
  // If user sends "forgot pin", start forgot-pin flow.
  if (msgBody.toLowerCase() === 'forgot pin') {
    await message.reply(`😥 Please enter your registered phone number so we can assist with a PIN reset:`);
    sessions[chatId] = { state: 'forgot_pin' };
    return;
  }
  // Navigation: "00" returns to Main Menu.
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
  // Registration/Login flow.
  let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!sessions[chatId]) {
    sessions[chatId] = { state: registeredUser ? 'awaiting_menu_selection' : 'start' };
  }
  let session = sessions[chatId];

  // Handle login process.
  if (session.state === 'login') {
    let userCandidate = Object.values(users).find(u => u.whatsAppId === chatId);
    if (userCandidate && msgBody === userCandidate.securityPIN) {
      await message.reply(`😊 Welcome back, ${userCandidate.firstName}! You are now logged in. Type "00" for the Main Menu.`);
      session.state = 'awaiting_menu_selection';
      return;
    } else {
      await message.reply(`❌ Incorrect PIN. Please try again or type "forgot pin" for assistance.`);
      return;
    }
  }
  // Handle forgot-pin process.
  if (session.state === 'forgot_pin') {
    if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
      await message.reply(`❌ Invalid phone format. Please re-enter your registered phone number.`);
      return;
    }
    await message.reply(`🙏 Thank you. An alert has been sent to the admin. Please wait for further assistance.`);
    notifyAdmins(`⚠️ *Forgot PIN Alert:*\nUser with phone ${msgBody} has requested a PIN reset.`);
    session.state = 'awaiting_menu_selection';
    return;
  }
  // If already registered, check for banned status.
  if (registeredUser) {
    if (registeredUser.banned) {
      await message.reply(`💔 You have been banned from FY'S INVESTMENT BOT.\nReason: ${registeredUser.bannedReason || 'No reason specified.'}\nPlease contact support if you believe this is an error.`);
      return;
    }
    await handleUserSession(message, session, registeredUser);
  } else {
    // Registration: if first message starts with "REF", auto-capture referral.
    if (session.state === 'start' && msgBody.toUpperCase().startsWith('REF')) {
      session.referredBy = Object.values(users).find(u => u.referralCode === msgBody.toUpperCase())?.whatsAppId || null;
      await message.reply(`👍 Referral detected! Now, please enter your first name to begin registration.`);
      session.state = 'awaiting_first_name';
      return;
    }
    // Otherwise, proceed with registration.
    await handleRegistration(message, session);
  }
});

// -----------------------------------
// DEPOSIT STATUS HANDLER (for option 4 in Balance submenu)
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
    `Thank you for choosing FY'S Investment Bot! Type "00" to return to the Main Menu. 😊`
  );
}

// -----------------------------------
// REGISTRATION HANDLER (and check for duplicate registration)
// -----------------------------------
async function handleRegistration(message, session) {
  const chatId = message.from;
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'start':
      await message.reply(
        `👋 Welcome to *FY'S INVESTMENT BOT*!\n\n` +
        `Please enter your *first name* to begin your journey.`
      );
      session.state = 'awaiting_first_name';
      break;
    case 'awaiting_first_name':
      session.firstName = msgBody;
      setTimeout(async () => {
        await message.reply(`✨ Great, *${session.firstName}*!\nNow, please provide your *second name*:`);
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
          await message.reply(`👍 Referral code accepted! Now, please enter your phone number (e.g. 070XXXXXXXX).`);
        } else {
          await message.reply(`⚠️ Referral code not found. We'll continue without it. Please enter your phone number.`);
        }
      } else {
        await message.reply(`No referral code entered.\nPlease enter your phone number (e.g. 070XXXXXXXX).`);
      }
      session.state = 'awaiting_phone';
      break;
    }
    case 'awaiting_phone':
      if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
        await message.reply(`❌ Invalid format! Your number must start with 07 or 01 and be exactly 10 digits.\nPlease re-enter your phone number. 📞`);
      } else if (users[msgBody]) {
        await message.reply(`😮 This number is already registered with FY'S Investment Bot!\nPlease type *login* to access your account or contact support.`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.phone = msgBody;
        await message.reply(`🔒 Now, please create a *4-digit PIN* for secure withdrawals (this will be your withdrawal PIN).`);
        session.state = 'awaiting_withdrawal_pin';
      }
      break;
    case 'awaiting_withdrawal_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Please enter a valid 4-digit PIN. 🔢`);
      } else {
        session.withdrawalPIN = msgBody;
        await message.reply(`Almost there! Create a *4-digit security PIN* (used for login/session security). 🔐`);
        session.state = 'awaiting_security_pin';
      }
      break;
    case 'awaiting_security_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN! Kindly enter a 4-digit security PIN.`);
      } else {
        session.securityPIN = msgBody;
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
          `✅ Registration successful, *${newUser.firstName}*!\nYour unique referral code is: *${newUser.referralCode}*.\nWelcome aboard – let the journey to prosperity begin! 🚀\nType "00" to return to the Main Menu.`
        );
        sessions[chatId] = { state: 'awaiting_menu_selection' };
      }
      break;
    default:
      await message.reply(`😕 Something went wrong. Please type "00" to return to the Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

// -----------------------------------
// USER SESSION HANDLER (Main Menu & Options)
// -----------------------------------
async function handleUserSession(message, session, user) {
  const chatId = message.from;
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_menu_selection':
      switch (msgBody) {
        case '1': // Invest
          session.state = 'invest';
          await message.reply(`💰 Please enter the *investment amount* (min Ksh ${MIN_INVESTMENT}, max Ksh ${MAX_INVESTMENT}):`);
          break;
        case '2': // Check Balance
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
        case '3': // Withdraw
          session.state = 'withdraw';
          await message.reply(
            `💸 *Withdrawal Options:*\n` +
            `1️⃣ Withdraw Referral Earnings\n` +
            `2️⃣ Withdraw Investment Earnings (Account Balance)\n` +
            `Please reply with 1 or 2.`
          );
          break;
        case '4': // Deposit
          session.state = 'deposit';
          await message.reply(`💵 Please enter the deposit amount:\n*Instructions:* ${DEPOSIT_INSTRUCTIONS}`);
          break;
        case '5': // Change PIN
          session.state = 'change_pin';
          await message.reply(`🔑 Please enter your current 4-digit PIN to change it:`);
          break;
        case '6': // My Referral Link
          {
            const referralLink = `https://wa.me/${BOT_PHONE}?text=REF${encodeURIComponent(user.referralCode)}`;
            await message.reply(
              `🔗 *Your Exclusive Referral Link:*\n${referralLink}\nShare it with friends to earn a bonus on their investments!\nType "00" to return to the Main Menu.`
            );
            session.state = 'awaiting_menu_selection';
          }
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
        await message.reply(`⚠️ Insufficient funds (Ksh ${user.accountBalance}). Please deposit funds. Type "00" for Main Menu.`);
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
        // Referral bonus for the referrer.
        if (user.investments.length === 1 && user.referredBy) {
          let referrer = Object.values(users).find(u => u.whatsAppId === user.referredBy);
          if (referrer) {
            let bonus = session.investAmount * (REFERRAL_PERCENTAGE / 100);
            referrer.referralEarnings += bonus;
            referrer.referrals.push(user.phone);
            console.log(`📢 [${getKenyaTime()}] Referral bonus: ${referrer.firstName} earned Ksh ${bonus.toFixed(2)} from ${user.firstName}'s investment.`);
          }
        }
        saveUsers();
        await message.reply(
          `✅ Your investment of Ksh ${session.investAmount} has been confirmed!\n` +
          `Expected Earnings (@${EARNING_PERCENTAGE}%): Ksh ${investment.expectedReturn}\n` +
          `It will mature in ${INVESTMENT_DURATION} minutes.\n` +
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
          await message.reply(`💳 *Account Balance:*\nYour balance is Ksh ${user.accountBalance}.\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          session.state = 'awaiting_menu_selection';
          break;
        case '2':
          await message.reply(`🎉 *Referral Earnings:*\nYou have earned Ksh ${user.referralEarnings} from referrals.\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          session.state = 'awaiting_menu_selection';
          break;
        case '3':
          if (user.investments.length === 0) {
            await message.reply(`📄 *Investment History:*\nNo investments yet.\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          } else {
            let history = user.investments.map((inv, i) =>
              `${i + 1}. Amount: Ksh ${inv.amount}, Expected: Ksh ${inv.expectedReturn}, Date: ${inv.date}, Status: ${inv.status}`
            ).join('\n');
            await message.reply(`📊 *Your Investment History:*\n${history}\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        case '4':
          if (user.deposits.length === 0) {
            await message.reply(`📄 *Deposit Records:*\nNo deposits recorded yet.\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          } else {
            let depList = user.deposits.map((dep, i) =>
              `${i + 1}. ID: ${dep.depositID}, Amount: Ksh ${dep.amount}, Date: ${dep.date}, Status: ${dep.status}`
            ).join('\n');
            await message.reply(`💵 *Your Deposit Statuses:*\n${depList}\n[${getKenyaTime()}]\nType "00" for Main Menu.`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        default:
          await message.reply(`❓ Please reply with 1, 2, 3, or 4.`);
          break;
      }
      break;
    case 'withdraw': {
      // Present two withdrawal choices.
      session.state = 'withdraw_choice';
      await message.reply(
        `💸 *Withdrawal Options:*\n` +
        `1️⃣ Withdraw Referral Earnings\n` +
        `2️⃣ Withdraw Investment Earnings (Account Balance)\n` +
        `Please reply with 1 or 2.`
      );
      break;
    }
    case 'withdraw_choice':
      if (msgBody === '1') {
        if (user.referralEarnings < MIN_WITHDRAWAL) {
          await message.reply(`❌ Your referral earnings are below the minimum withdrawal amount of Ksh ${MIN_WITHDRAWAL}.`);
        } else {
          user.referralEarnings -= MIN_WITHDRAWAL; // For demo purposes, here we simply subtract the minimum.
          let wd = {
            amount: MIN_WITHDRAWAL,
            date: getKenyaTime(),
            withdrawalID: generateWithdrawalID(),
            status: 'pending'
          };
          user.withdrawals.push(wd);
          saveUsers();
          await message.reply(
            `💸 *Withdrawal Request Received!*\nWithdrawal ID: ${wd.withdrawalID}\nAmount: Ksh ${wd.amount} (Referral Earnings)\nStatus: Under review\n[${getKenyaTime()}]\nType "00" for Main Menu.`
          );
          await notifyAdmins(
            `🔔 *Withdrawal Request (Referral Earnings):*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${wd.amount}\nWithdrawal ID: ${wd.withdrawalID}\n[${getKenyaTime()}]`
          );
        }
        session.state = 'awaiting_menu_selection';
      } else if (msgBody === '2') {
        if (user.accountBalance < MIN_WITHDRAWAL) {
          await message.reply(`❌ Your account balance is below the minimum withdrawal amount of Ksh ${MIN_WITHDRAWAL}.`);
        } else {
          user.accountBalance -= MIN_WITHDRAWAL; // For demo, subtract minimum.
          let wd = {
            amount: MIN_WITHDRAWAL,
            date: getKenyaTime(),
            withdrawalID: generateWithdrawalID(),
            status: 'pending'
          };
          user.withdrawals.push(wd);
          saveUsers();
          await message.reply(
            `💸 *Withdrawal Request Received!*\nWithdrawal ID: ${wd.withdrawalID}\nAmount: Ksh ${wd.amount} (Investment Earnings)\nStatus: Under review\n[${getKenyaTime()}]\nType "00" for Main Menu.`
          );
          await notifyAdmins(
            `🔔 *Withdrawal Request (Investment Earnings):*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${wd.amount}\nWithdrawal ID: ${wd.withdrawalID}\n[${getKenyaTime()}]`
          );
        }
        session.state = 'awaiting_menu_selection';
      } else {
        await message.reply(`❓ Please reply with 1 or 2.`);
      }
      break;
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
          `💵 *Deposit Request Received!*\nDeposit ID: ${dep.depositID}\nAmount: Ksh ${amount}\nPlease follow these instructions to complete your deposit:\n${DEPOSIT_INSTRUCTIONS}\nStatus: Under review\n[${getKenyaTime()}]\nType "00" for Main Menu.`
        );
        await notifyAdmins(
          `🔔 *Deposit Request:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${amount}\nDeposit ID: ${dep.depositID}\n[${getKenyaTime()}]`
        );
      }
      session.state = 'awaiting_menu_selection';
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

  // admin CMD – show command list.
  if (command === 'cmd') {
    await message.reply(
      `⚙️ *ADMIN COMMANDS:*\n\n` +
      `1. admin CMD – Show this list.\n` +
      `2. admin view users – List all registered users (detailed, numbered).\n` +
      `3. admin view investments – List all investments.\n` +
      `4. admin view deposits – List all deposits.\n` +
      `5. admin approve deposit <DEP-ID> – Approve a deposit.\n` +
      `6. admin reject deposit <DEP-ID> <Reason> – Reject a deposit with reason.\n` +
      `7. admin approve withdrawal <WD-ID> – Approve a withdrawal.\n` +
      `8. admin reject withdrawal <WD-ID> <Reason> – Reject a withdrawal with reason.\n` +
      `9. admin ban user <phone> <Reason> – Ban a user.\n` +
      `10. admin unban <phone> – Unban a user.\n` +
      `11. admin resetpin <phone> <new_pin> – Reset a user’s PIN.\n` +
      `12. admin setearn <percentage> – Set earning percentage (1–100).\n` +
      `13. admin setreferral <percentage> – Set referral bonus percentage (1–100).\n` +
      `14. admin setduration <minutes> – Set investment duration in minutes.\n` +
      `15. admin setmininvestment <amount> – Set minimum investment.\n` +
      `16. admin setmaxinvestment <amount> – Set maximum investment.\n` +
      `17. admin setminwithdrawal <amount> – Set minimum withdrawal.\n` +
      `18. admin setmaxwithdrawal <amount> – Set maximum withdrawal.\n` +
      `19. admin setdeposit <instructions> <deposit_number> – Set deposit instructions & number.\n` +
      `20. admin addadmin <phone> – Add a new admin (SUPER ADMIN ONLY).\n` +
      `21. admin removeadmin <phone> – Remove an admin (SUPER ADMIN ONLY).\n` +
      `22. admin bulk <message> – Send a bulk message to all users.\n` +
      `[${getKenyaTime()}]`
    );
    return;
  }
  // Detailed view of users.
  if (command === 'view' && subCommand === 'users') {
    let userList = Object.values(users)
      .map((u, i) =>
        `${i + 1}. ${u.firstName} ${u.secondName} (Phone: ${u.phone})\n   ➤ Balance: Ksh ${u.accountBalance}, Earnings: Ksh ${u.referralEarnings}\n   ➤ PINs: Withdrawal: ${u.withdrawalPIN}, Security: ${u.securityPIN}\n   ➤ Activities: Investments: ${u.investments.length}, Deposits: ${u.deposits.length}, Withdrawals: ${u.withdrawals.length}\n`
      ).join('\n');
    if (!userList) userList = 'No registered users found.';
    await message.reply(`📋 *Detailed User List:*\n\n${userList}\n[${getKenyaTime()}]`);
    return;
  }
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
          client.sendMessage(u.whatsAppId,
            `🎉 Congratulations ${u.firstName}! Your withdrawal request (ID: ${wd.withdrawalID}) for Ksh ${wd.amount} has been approved. Thank you for trusting FY'S Investment Bot!`
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
  if (command === 'resetpin') {
    let phone = msgParts[2];
    let newPin = msgParts[3];
    if (!phone || !newPin || !/^\d{4}$/.test(newPin)) {
      await message.reply(`Usage: admin resetpin <phone> <new_pin> (4-digit)`);
      return;
    }
    if (!users[phone]) {
      await message.reply(`User with phone ${phone} not found.`);
      return;
    }
    users[phone].withdrawalPIN = newPin;
    saveUsers();
    await message.reply(`✅ PIN for user ${phone} has been reset to ${newPin}.`);
    return;
  }
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
  if (command === 'setmaxinvestment') {
    let amount = parseFloat(msgParts[3]);
    if (isNaN(amount) || amount < MIN_INVESTMENT) {
      await message.reply(`Usage: admin setmaxinvestment <amount> (must be > min investment)`);
      return;
    }
    MAX_INVESTMENT = amount;
    await message.reply(`✅ Maximum investment set to Ksh ${MAX_INVESTMENT}.`);
    return;
  }
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
  if (command === 'setmaxwithdrawal') {
    let amount = parseFloat(msgParts[3]);
    if (isNaN(amount) || amount < MIN_WITHDRAWAL) {
      await message.reply(`Usage: admin setmaxwithdrawal <amount> (must be > min withdrawal)`);
      return;
    }
    MAX_WITHDRAWAL = amount;
    await message.reply(`✅ Maximum withdrawal set to Ksh ${MAX_WITHDRAWAL}.`);
    return;
  }
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
  if (command === 'addadmin') {
    // Only super admin can add admins.
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
  if (command === 'removeadmin') {
    // Only super admin can remove admins.
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
      await message.reply(`✅ ${remAdminPhone} has been removed from admin list.`);
    }
    return;
  }
  if (command === 'bulk') {
    // admin bulk <message> sends bulk text to all users.
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
const PORT = process.env.PORT || 3000;
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
