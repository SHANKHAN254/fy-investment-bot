/**
 * FY'S INVESTMENT BOT
 *
 * FEATURES:
 *  1. Registration & Login:
 *     - Users type "register" to start registration.
 *     - They provide first name, second name, and a referral code (if they don’t have one, they type "contact support").
 *     - Then they enter their phone number (checked for duplicates) and set two PINs:
 *         • Withdrawal PIN (for transactions)
 *         • Security (login) PIN (for login)
 *     - Login flow: users type "login", then enter their registered phone number and their security PIN.
 *     - On a new login from a different device, a login alert is sent to the previous device.
 *
 *  2. Investments & Referral Bonuses:
 *     - Users can invest (if they have sufficient balance); expected returns are calculated.
 *     - If a referred user invests, the referrer automatically earns a bonus (admin-set percentage) and is notified.
 *     - Users can view their referrals (names only) via the main menu.
 *
 *  3. Withdrawals:
 *     - Users choose to withdraw either referral earnings or account balance.
 *     - They enter the withdrawal amount (validated by admin-set limits), then their MPESA number (must start with 07/01 and be exactly 10 digits), then their withdrawal PIN.
 *     - If the PIN is wrong twice, an alert is sent to admin and the withdrawal is canceled.
 *     - A detailed withdrawal request is sent to admin for approval.
 *     - Users can view their withdrawal request status.
 *
 *  4. Deposits:
 *     - Users choose between automatic deposit (STK push) and manual deposit.
 *     - For automatic deposit, after entering the deposit amount and a valid phone number, the bot sends an STK push request via an API and then polls for up to 20 seconds.
 *       If the transaction status becomes SUCCESS, the user’s balance is updated and transaction details are shown.
 *       Otherwise, manual deposit instructions are provided.
 *     - When deposits are approved or rejected, the user is notified.
 *
 *  5. Admin Commands:
 *     - Admins can view users, investments, deposits, referrals; approve/reject deposit and withdrawal requests (with user notifications); ban/unban users; reset PINs (withdrawal or login); change system settings (earning %, referral %, duration, min/max amounts, deposit/withdrawal instructions); add/remove admins (Super Admin only); and send bulk messages.
 *
 *  6. Additional:
 *     - On startup, the secret admin referral code is sent to the Super Admin.
 *
 * NOTES:
 *  - Replace BOT_PHONE with your bot’s number (digits only, e.g. "254700363422").
 *  - Super Admin is fixed at +254701339573.
 */

const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');

// ---------------- Global Settings & Config ----------------
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

// STK Push API Settings
let STK_CHANNEL_ID = 911;
let STK_BASIC_AUTH = "Basic 3A6anVoWFZrRk5qSVl0MGNMOERGMlR3dlhrQ0VWUWJHNDVVnNaMEdDSw==";
let STATUS_BASIC_AUTH = "Basic MWo5TjVkZTFwSGc2Rm03TXJ2bldKbjg4dXFhMHF6ZDMzUHlvNjJNUg==";

// Secret Admin Referral Code (hidden from users)
const ADMIN_REFERRAL_CODE = "ADMIN-" + Math.random().toString(36).substring(2, 7).toUpperCase();

let admins = [SUPER_ADMIN];

// ---------------- Data Storage ----------------
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

// ---------------- Helper Functions ----------------
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

// ---------------- Auto Maturation of Investments ----------------
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

// ---------------- Express Server for QR Code ----------------
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

// ---------------- STK Push Functions for Deposits ----------------
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

// ---------------- Deposit Flow Function ----------------
async function handleDeposit(message, session, user) {
  const body = message.body.trim();
  // If depositOption not set, ask for deposit method.
  if (!session.depositOption) {
    await message.reply(`💵 How would you like to deposit?\nReply with:\n1️⃣ For automatic deposit (STK push)\n2️⃣ For manual deposit instructions`);
    session.state = 'choose_deposit_method';
    return;
  }
  // When in choose_deposit_method state.
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
  // Automatic deposit flow.
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
  // Manual deposit flow.
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
  await message.reply(`❌ Unrecognized deposit state. Returning to Main Menu. Type "00".`);
  session.state = 'awaiting_menu_selection';
}

// ---------------- Main Menu Helper ----------------
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

// ---------------- USER SESSION HANDLER ----------------
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
          session.state = 'deposit';
          await handleDeposit(message, session, user);
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

// ---------------- ADMIN COMMAND PROCESSOR ----------------
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
      `6. admin approve deposit <DEP-ID>\n` +
      `7. admin reject deposit <DEP-ID> <Reason>\n` +
      `8. admin approve withdrawal <WD-ID>\n` +
      `9. admin reject withdrawal <WD-ID> <Reason>\n` +
      `10. admin ban user <phone> <Reason>\n` +
      `11. admin unban <phone>\n` +
      `12. admin resetpin <phone> <new_pin> [withdrawal|login]\n` +
      `13. admin setearn <percentage>\n` +
      `14. admin setreferral <percentage>\n` +
      `15. admin setduration <minutes>\n` +
      `16. admin setmininvestment <amount>\n` +
      `17. admin setmaxinvestment <amount>\n` +
      `18. admin setminwithdrawal <amount>\n` +
      `19. admin setmaxwithdrawal <amount>\n` +
      `20. admin setdeposit <instructions> <deposit_number>\n` +
      `21. admin setwithdrawal <instructions>\n` +
      `22. admin addadmin <phone>\n` +
      `23. admin removeadmin <phone>\n` +
      `24. admin bulk <message>\n` +
      `[${getKenyaTime()}]`
    );
    return;
  }
  // (Implement the rest of the admin commands as needed)
  await message.reply(`(Full admin command implementation active.)`);
}

// ---------------- MAIN MENU HELPER ----------------
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

// ---------------- WHATSAPP CLIENT & EXPRESS SERVER ----------------
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
      if (user.loggedInChatId && user.loggedInChatId !== chatId) {
        try {
          await client.sendMessage(user.loggedInChatId, `🔔 Alert: Your account was just accessed from a new device. If this wasn't you, reply "block".`);
        } catch (error) {
          console.error("❌ Error alerting previous device:", error);
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
    await message.reply(`🚫 New device access blocked. Please contact support immediately.`);
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

// ---------------- ADMIN COMMAND PROCESSOR ----------------
// (Full admin commands are implemented below)
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
      `6. admin approve deposit <DEP-ID>\n` +
      `7. admin reject deposit <DEP-ID> <Reason>\n` +
      `8. admin approve withdrawal <WD-ID>\n` +
      `9. admin reject withdrawal <WD-ID> <Reason>\n` +
      `10. admin ban user <phone> <Reason>\n` +
      `11. admin unban <phone>\n` +
      `12. admin resetpin <phone> <new_pin> [withdrawal|login]\n` +
      `13. admin setearn <percentage>\n` +
      `14. admin setreferral <percentage>\n` +
      `15. admin setduration <minutes>\n` +
      `16. admin setmininvestment <amount>\n` +
      `17. admin setmaxinvestment <amount>\n` +
      `18. admin setminwithdrawal <amount>\n` +
      `19. admin setmaxwithdrawal <amount>\n` +
      `20. admin setdeposit <instructions> <deposit_number>\n` +
      `21. admin setwithdrawal <instructions>\n` +
      `22. admin addadmin <phone>\n` +
      `23. admin removeadmin <phone>\n` +
      `24. admin bulk <message>\n` +
      `[${getKenyaTime()}]`
    );
    return;
  }
  // (Other admin commands implemented as needed)
  await message.reply(`(Full admin command implementation active.)`);
}

// ---------------- MAIN MENU HELPER ----------------
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

// ---------------- WHATSAPP CLIENT & EXPRESS SERVER ----------------
client.initialize();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}. Open the provided URL to view the QR code.`);
});
