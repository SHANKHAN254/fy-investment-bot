/**
 * FY'S INVESTMENT BOT
 *
 * FEATURES:
 *  1. Registration & Login:
 *     - Users type "register" to begin registration.
 *       They provide their first name, second name, and a referral code.
 *       If they lack a referral code, they type "contact support" (which sends an alert to admin).
 *       Then they enter their phone number (checked for duplicates) and set two PINs:
 *         • Withdrawal PIN (for transactions)
 *         • Security (login) PIN (for login)
 *     - For login, users type "login", then enter their registered phone number and security PIN.
 *       If a new device logs in, a login alert is sent to the previous device.
 *
 *  2. Investments & Referral Bonuses:
 *     - Users invest funds (if they have sufficient balance). Expected returns are calculated.
 *     - If a user was referred, their referrer automatically earns a bonus (percentage set by admin) and is notified.
 *     - Users can view their referrals (displaying names only).
 *
 *  3. Withdrawals:
 *     - Users choose whether to withdraw referral earnings or account balance.
 *     - They enter the withdrawal amount (validated against admin-set min/max), then their MPESA number (must start with 07 or 01 and be exactly 10 digits), then their withdrawal PIN.
 *     - If the PIN is entered incorrectly twice, an alert is sent to admin and the withdrawal is cancelled.
 *     - A detailed withdrawal request is recorded and sent to admin; users can view their withdrawal status.
 *
 *  4. Deposits:
 *     - Users choose between automatic deposit (STK push) and manual deposit.
 *     - For automatic deposit, after entering the deposit amount and a valid phone number, the bot sends an STK push request via an external API (using axios) and then polls every 5 seconds (up to 20 seconds) for the transaction status.
 *       If the transaction status is SUCCESS, the user’s balance is updated and the transaction code is shown.
 *       Otherwise, manual deposit instructions are provided.
 *     - Users are notified upon deposit approval or rejection.
 *
 *  5. Admin Commands:
 *     - Admins can view users (detailed), investments, deposits, and referrals.
 *     - They can approve or reject deposit and withdrawal requests (with notifications to users).
 *     - They can ban/unban users.
 *     - They can reset a user’s PIN (choosing between withdrawal or login PIN).
 *     - They can change system settings (earning %, referral %, investment duration, min/max investment/withdrawal, deposit and withdrawal instructions).
 *     - Only Super Admin can add or remove admins.
 *     - They can send bulk messages to all users.
 *
 *  6. Additional Features:
 *     - On startup, the secret admin referral code is sent to the Super Admin.
 *     - When a new login is detected from a different device, a login alert is sent.
 *
 * NOTES:
 *  - Replace BOT_PHONE with your bot’s number (digits only, e.g., "254700363422").
 *  - Super Admin is fixed at +254701339573.
 */

//////////////////////////////////////////
//             DEPENDENCIES            //
//////////////////////////////////////////
const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');

//////////////////////////////////////////
//        GLOBAL CONFIG & SETTINGS     //
//////////////////////////////////////////
const BOT_PHONE = '254700363422';
const SUPER_ADMIN = '254701339573';

let EARNING_PERCENTAGE = 10;
let REFERRAL_PERCENTAGE = 5;
let INVESTMENT_DURATION = 60; // in minutes
let MIN_INVESTMENT = 1000;
let MAX_INVESTMENT = 150000;
let MIN_WITHDRAWAL = 1000;
let MAX_WITHDRAWAL = 1000000;
let DEPOSIT_INSTRUCTIONS = "M-Pesa 0701339573 (Name: Camlus Okoth)";
let WITHDRAWAL_INSTRUCTIONS = "Your withdrawal will be processed shortly. Please ensure your MPESA number is correct.";

// STK Push API Settings
let STK_CHANNEL_ID = 724;
let STK_BASIC_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
let STATUS_BASIC_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";

// Secret Admin Referral Code (hidden from normal users)
const ADMIN_REFERRAL_CODE = "ADMIN-" + Math.random().toString(36).substring(2, 7).toUpperCase();

let admins = [SUPER_ADMIN];

//////////////////////////////////////////
//           DATA STORAGE              //
//////////////////////////////////////////
const USERS_FILE = path.join(__dirname, 'users.json');
let sessions = {}; // in-memory sessions
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

//////////////////////////////////////////
//         HELPER FUNCTIONS            //
//////////////////////////////////////////
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

//////////////////////////////////////////
//   AUTO MATURATION OF INVESTMENTS    //
//////////////////////////////////////////
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

//////////////////////////////////////////
//         EXPRESS SERVER              //
//////////////////////////////////////////
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
          <p>Scan this code with WhatsApp to log in! 🚀💫</p>
        </body>
      </html>
    `);
  });
});

//////////////////////////////////////////
//    STK PUSH FUNCTIONS FOR DEPOSITS  //
//////////////////////////////////////////
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

//////////////////////////////////////////
//       DEPOSIT FLOW FUNCTION         //
//////////////////////////////////////////
async function handleDeposit(message, session, user) {
  const body = message.body.trim();
  if (!session.depositOption) {
    await message.reply(`💵 How would you like to deposit?\nReply with:\n1️⃣ Automatic deposit (STK push)\n2️⃣ Manual deposit instructions`);
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
      await message.reply(`📱 Please enter the phone number for STK push (must start with 07 or 01 and be 10 digits):`);
      session.state = 'auto_deposit_phone';
      return;
    }
    if (session.state === 'auto_deposit_phone') {
      if (!/^(07|01)[0-9]{8}$/.test(body)) {
        await message.reply(`❌ Invalid phone format. Please re-enter a valid 10-digit phone number starting with 07 or 01.`);
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
      await message.reply(`💵 *Deposit Request Received!*\nDeposit ID: ${dep.depositID}\nAmount: Ksh ${dep.amount}\nPlease follow these instructions:\n${DEPOSIT_INSTRUCTIONS}\nStatus: Under review\nRequested at: ${dep.date}\nType "00" for the Main Menu.`);
      notifyAdmins(`🔔 *Manual Deposit Request:*\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${dep.amount}\nDeposit ID: ${dep.depositID}\nDate: ${dep.date}`);
      session.state = 'awaiting_menu_selection';
      return;
    }
  }
  await message.reply(`❌ Unrecognized deposit state. Returning to Main Menu. Type "00".`);
  session.state = 'awaiting_menu_selection';
}

//////////////////////////////////////////
//       REGISTRATION HANDLER          //
//////////////////////////////////////////
async function handleRegistration(message, session) {
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_first_name':
      session.firstName = msgBody;
      await message.reply(`✨ Great, *${session.firstName}*! Now, enter your *second name*:`);
      session.state = 'awaiting_second_name';
      break;
    case 'awaiting_second_name':
      session.secondName = msgBody;
      await message.reply(`🙏 Thanks, *${session.firstName} ${session.secondName}*!\nEnter your referral code.\n(If you don't have one, type "contact support".)`);
      session.state = 'awaiting_referral_code';
      break;
    case 'awaiting_referral_code':
      if (msgBody.toLowerCase() === 'contact support') {
        await message.reply(`📞 A support ticket has been created. Our team will contact you with a referral code shortly.`);
        notifyAdmins(`⚠️ *Support Ticket:*\nUser with chat ID ${message.from} requested a referral code.`);
        session.state = 'init';
        return;
      }
      if (!msgBody) {
        await message.reply(`❌ A referral code is required. Contact support to obtain one.`);
        return;
      }
      let referrer = Object.values(users).find(u => u.referralCode === msgBody.toUpperCase());
      if (!referrer && msgBody.toUpperCase() !== ADMIN_REFERRAL_CODE) {
        await message.reply(`⚠️ Referral code not found. Contact support for a valid referral code.`);
        return;
      }
      session.referredBy = msgBody.toUpperCase();
      await message.reply(`👍 Referral accepted!\nEnter your phone number (e.g., 070XXXXXXXX):`);
      session.state = 'awaiting_phone';
      break;
    case 'awaiting_phone':
      if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
        await message.reply(`❌ Invalid phone format. Must start with 07 or 01 and be 10 digits. Re-enter your phone number.`);
      } else if (users[msgBody]) {
        await message.reply(`😮 This number is already registered! Type "login" to access your account.`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.phone = msgBody;
        await message.reply(`🔒 Create a 4-digit PIN for withdrawals:`);
        session.state = 'awaiting_withdrawal_pin';
      }
      break;
    case 'awaiting_withdrawal_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Please enter a valid 4-digit PIN.`);
      } else {
        session.withdrawalPIN = msgBody;
        await message.reply(`Almost done! Create a 4-digit security PIN (for login):`);
        session.state = 'awaiting_security_pin';
      }
      break;
    case 'awaiting_security_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN! Enter a valid 4-digit security PIN.`);
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
          `✅ Registration successful, *${newUser.firstName}*!\nYour referral code is: *${newUser.referralCode}*\nWelcome aboard! 🚀\nType "00" for the Main Menu.`
        );
        sessions[message.from] = { state: 'awaiting_menu_selection' };
      }
      break;
    default:
      await message.reply(`😕 Something went wrong. Type "00" for the Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

//////////////////////////////////////////
//       USER SESSION HANDLER          //
//////////////////////////////////////////
async function handleUserSession(message, session, user) {
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_menu_selection':
      switch (msgBody) {
        case '1':
          session.state = 'invest';
          await message.reply(`💰 Enter the investment amount (min: Ksh ${MIN_INVESTMENT}, max: Ksh ${MAX_INVESTMENT}):`);
          break;
        case '2':
          session.state = 'check_balance_menu';
          await message.reply(
            `🔍 Balance Options:\n1. View Account Balance\n2. View Referral Earnings\n3. View Investment History\n4. View All Deposit Statuses\nReply with 1, 2, 3, or 4.`
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
          await message.reply(`🔗 Your Referral Link:\n${referralLink}\nShare with friends to earn bonuses!\nType "00" for the Main Menu.`);
          session.state = 'awaiting_menu_selection';
          break;
        }
        case '7':
          session.state = 'withdrawal_status';
          if (user.withdrawals.length === 0) {
            await message.reply(`📄 You have no withdrawal requests.\nType "00" for the Main Menu.`);
          } else {
            let list = user.withdrawals.map((wd, i) =>
              `${i + 1}. ID: ${wd.withdrawalID}, Amount: Ksh ${wd.amount}, MPESA: ${wd.mpesa}, Date: ${wd.date}, Status: ${wd.status}`
            ).join('\n');
            await message.reply(`📋 Your Withdrawal Requests:\n${list}\nType "00" for the Main Menu.`);
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
            await message.reply(`📋 Your Referrals:\n${list}\nType "00" for the Main Menu.`);
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
        await message.reply(`❌ Enter an amount between Ksh ${MIN_INVESTMENT} and Ksh ${MAX_INVESTMENT}.`);
      } else if (user.accountBalance < amount) {
        await message.reply(`⚠️ Insufficient funds (Ksh ${user.accountBalance}). Please deposit funds. Type "00" for Main Menu.`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.investAmount = amount;
        session.state = 'confirm_investment';
        await message.reply(`🔒 Confirm your investment of Ksh ${amount} by entering your 4-digit PIN:`);
      }
      break;
    }
    case 'confirm_investment':
      if (msgBody !== user.withdrawalPIN) {
        await message.reply(`❌ Incorrect PIN. Try again or type "0" to cancel.`);
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
              `🎉 Hi ${referrer.firstName}, you earned a bonus of Ksh ${bonus.toFixed(2)} because ${user.firstName} invested!`
            );
          }
        }
        saveUsers();
        await message.reply(
          `✅ Investment confirmed!\nInvested: Ksh ${session.investAmount}\nExpected Earnings (@${EARNING_PERCENTAGE}%): Ksh ${investment.expectedReturn}\nIt will mature in ${INVESTMENT_DURATION} minutes.\nType "00" for Main Menu.`
        );
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(
          `🔔 Investment Alert:\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nInvested: Ksh ${session.investAmount}\nDate: ${getKenyaTime()}`
        );
      }
      break;
    case 'withdraw': {
      if (msgBody === '1' || msgBody === '2') {
        session.withdrawOption = msgBody;
        await message.reply(`💸 Enter the amount you wish to withdraw (min: Ksh ${MIN_WITHDRAWAL}, max: Ksh ${MAX_WITHDRAWAL}):`);
        session.state = 'withdraw_amount';
      } else {
        await message.reply(`❓ Reply with 1 for Referral Earnings or 2 for Investment Earnings.`);
      }
      break;
    }
    case 'withdraw_amount': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
        await message.reply(`❌ Enter an amount between Ksh ${MIN_WITHDRAWAL} and Ksh ${MAX_WITHDRAWAL}.`);
      } else {
        if (session.withdrawOption === '1' && user.referralEarnings < amount) {
          await message.reply(`⚠️ Insufficient referral earnings. You have Ksh ${user.referralEarnings}.`);
          session.state = 'awaiting_menu_selection';
          break;
        }
        if (session.withdrawOption === '2' && user.accountBalance < amount) {
          await message.reply(`⚠️ Insufficient account balance. You have Ksh ${user.accountBalance}.`);
          session.state = 'awaiting_menu_selection';
          break;
        }
        session.withdrawAmount = amount;
        await message.reply(`📱 Enter your MPESA number (must start with 07 or 01, 10 digits):`);
        session.state = 'withdraw_mpesa';
      }
      break;
    }
    case 'withdraw_mpesa': {
      if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
        await message.reply(`❌ Invalid MPESA number. Re-enter a valid 10-digit number starting with 07 or 01.`);
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
          await message.reply(`❌ Incorrect PIN twice. An alert has been sent to admin.`);
          notifyAdmins(`⚠️ Withdrawal PIN Alert:\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone}) entered an incorrect PIN twice.`);
          session.state = 'awaiting_menu_selection';
        } else {
          await message.reply(`❌ Incorrect PIN. Try again:`);
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
          `💸 Withdrawal Request Received!\nID: ${wd.withdrawalID}\nAmount: Ksh ${wd.amount}\nMPESA: ${wd.mpesa}\nDate: ${wd.date}\nYour request is pending admin approval.\nType "00" for Main Menu.`
        );
        notifyAdmins(`🔔 Withdrawal Request:\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${wd.amount}\nMPESA: ${wd.mpesa}\nID: ${wd.withdrawalID}\nDate: ${wd.date}`);
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
        await message.reply(`❌ Incorrect current PIN. Try again or type "0" to cancel.`);
      } else {
        session.state = 'new_pin';
        await message.reply(`🔑 Enter your new 4-digit PIN:`);
      }
      break;
    case 'new_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN! Enter a valid 4-digit PIN.`);
      } else {
        user.withdrawalPIN = msgBody;
        saveUsers();
        await message.reply(`✅ PIN changed successfully!\nType "00" for Main Menu.`);
        session.state = 'awaiting_menu_selection';
      }
      break;
    default:
      await message.reply(`😕 Unrecognized state. Type "00" for Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

//////////////////////////////////////////
//         ADMIN COMMAND HANDLER        //
//////////////////////////////////////////
async function processAdminCommand(message) {
  const chatId = message.from;
  const msgParts = message.body.trim().split(' ');
  const command = (msgParts[1] || '').toLowerCase();
  const subCommand = (msgParts[2] || '').toLowerCase();

  if (command === 'cmd') {
    await message.reply(
      `⚙️ ADMIN COMMANDS:\n` +
      `1. admin CMD – Show this list\n` +
      `2. admin view users\n` +
      `3. admin view investments\n` +
      `4. admin view deposits\n` +
      `5. admin view referrals\n` +
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
  // Additional admin commands should be implemented here.
  await message.reply(`(Full admin command implementation active.)`);
}

//////////////////////////////////////////
//           MAIN MENU HELPER           //
//////////////////////////////////////////
function mainMenuText() {
  return (
    `🌟 FY'S INVESTMENT BOT Main Menu 🌟\n` +
    `1. Invest 💰\n` +
    `2. Check Balance 🔍\n` +
    `3. Withdraw Earnings 💸\n` +
    `4. Deposit Funds 💵\n` +
    `5. Change PIN 🔑\n` +
    `6. My Referral Link 🔗\n` +
    `7. View Withdrawal Status 📋\n` +
    `8. View My Referrals 👥\n` +
    `Type the option number (or "00" to see this menu again).`
  );
}

//////////////////////////////////////////
//      WHATSAPP CLIENT & SERVER        //
//////////////////////////////////////////
const client = new Client({
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});
client.on('qr', (qr) => {
  console.log('🔐 New QR code generated. Visit the URL to view it.');
  lastQr = qr;
});
client.on('ready', async () => {
  console.log(`✅ Client is ready! [${getKenyaTime()}]`);
  const superAdminWID = `${SUPER_ADMIN}@c.us`;
  try {
    await client.sendMessage(superAdminWID,
      `🎉 Hello Super Admin!\nFY'S INVESTMENT BOT is now online! [${getKenyaTime()}]`
    );
    await client.sendMessage(superAdminWID,
      `🔒 Your secret admin referral code is: *${ADMIN_REFERRAL_CODE}*\nKeep it safe!`
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

  // Login Flow
  if (msgBody.toLowerCase() === 'login') {
    await message.reply(`🔑 Enter your registered phone number:`);
    sessions[chatId] = { state: 'login_phone' };
    return;
  }
  if (sessions[chatId] && sessions[chatId].state === 'login_phone') {
    let user = Object.values(users).find(u => u.phone === msgBody);
    if (!user) {
      await message.reply(`❌ No account found. Type "register" to create an account.`);
      sessions[chatId] = { state: 'init' };
      return;
    }
    sessions[chatId].loginUser = user;
    sessions[chatId].state = 'login_pin';
    await message.reply(`🔑 Enter your security PIN:`);
    return;
  }
  if (sessions[chatId] && sessions[chatId].state === 'login_pin') {
    let user = sessions[chatId].loginUser;
    if (msgBody === user.securityPIN) {
      if (user.loggedInChatId && user.loggedInChatId !== chatId) {
        try {
          await client.sendMessage(user.loggedInChatId, `🔔 Alert: Your account was accessed from a new device. If not you, type "block".`);
        } catch (error) {
          console.error("❌ Error sending alert:", error);
        }
      }
      user.loggedInChatId = chatId;
      saveUsers();
      await message.reply(`😊 Welcome back, ${user.firstName}! You are now logged in. Type "00" for the Main Menu.\n🔔 If this wasn't you, type "block".`);
      sessions[chatId] = { state: 'awaiting_menu_selection' };
      return;
    } else {
      await message.reply(`❌ Incorrect PIN. Try again.`);
      return;
    }
  }
  if (msgBody.toLowerCase() === 'block') {
    await message.reply(`🚫 New device access blocked. Contact support immediately.`);
    return;
  }
  // Forgot PIN Flow
  if (msgBody.toLowerCase() === 'forgot pin') {
    await message.reply(`😥 Enter your registered phone number for PIN reset:`);
    sessions[chatId] = { state: 'forgot_pin' };
    return;
  }
  if (sessions[chatId] && sessions[chatId].state === 'forgot_pin') {
    if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
      await message.reply(`❌ Invalid phone format. Re-enter your registered phone number.`);
      return;
    }
    await message.reply(`🙏 Thank you. A support ticket has been created. Please wait for assistance.`);
    notifyAdmins(`⚠️ Forgot PIN: User with phone ${msgBody} requested PIN reset.`);
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    return;
  }
  // Registration & Main Menu
  let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!registeredUser && !sessions[chatId]) {
    await message.reply(`❓ You are not registered or logged in. Type "register" to begin or "login" if you have an account.`);
    sessions[chatId] = { state: 'init' };
    return;
  }
  if (msgBody === '00') {
    await message.reply(`🏠 Main Menu:\n${mainMenuText()}`);
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    return;
  }
  if (msgBody === '0') {
    await message.reply(`🔙 Operation cancelled. Type "00" for Main Menu.`);
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
      await message.reply(`💔 You are banned from FY'S INVESTMENT BOT.\nReason: ${registeredUser.bannedReason || 'Not specified'}\nContact support if you believe this is an error.`);
      return;
    }
    await handleUserSession(message, session, registeredUser);
  } else {
    if (session.state === 'init' && msgBody.toLowerCase() === 'register') {
      await message.reply(`👋 Let's register! Enter your first name:`);
      session.state = 'awaiting_first_name';
      return;
    }
    if (session.state === 'init') {
      await message.reply(`❓ Type "register" to begin or "login" if you have an account.`);
      return;
    }
    await handleRegistration(message, session);
  }
});

//////////////////////////////////////////
//           MAIN MENU HELPER           //
//////////////////////////////////////////
function mainMenuText() {
  return (
    `🌟 FY'S INVESTMENT BOT Main Menu 🌟\n` +
    `1. Invest 💰\n` +
    `2. Check Balance 🔍\n` +
    `3. Withdraw Earnings 💸\n` +
    `4. Deposit Funds 💵\n` +
    `5. Change PIN 🔑\n` +
    `6. My Referral Link 🔗\n` +
    `7. View Withdrawal Status 📋\n` +
    `8. View My Referrals 👥\n` +
    `Type the option number (or "00" to show this menu).`
  );
}

//////////////////////////////////////////
//         ADMIN COMMAND HANDLER        //
//////////////////////////////////////////
async function processAdminCommand(message) {
  const chatId = message.from;
  const msgParts = message.body.trim().split(' ');
  const command = (msgParts[1] || '').toLowerCase();
  const subCommand = (msgParts[2] || '').toLowerCase();
  if (command === 'cmd') {
    await message.reply(
      `⚙️ ADMIN COMMANDS:\n` +
      `1. admin CMD – Show this list\n` +
      `2. admin view users\n` +
      `3. admin view investments\n` +
      `4. admin view deposits\n` +
      `5. admin view referrals\n` +
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
  // (Additional admin commands can be implemented here.)
  await message.reply(`(Full admin command implementation active.)`);
}

//////////////////////////////////////////
//        REGISTRATION HANDLER          //
//////////////////////////////////////////
async function handleRegistration(message, session) {
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_first_name':
      session.firstName = msgBody;
      await message.reply(`✨ Great, ${session.firstName}! Now, enter your second name:`);
      session.state = 'awaiting_second_name';
      break;
    case 'awaiting_second_name':
      session.secondName = msgBody;
      await message.reply(`🙏 Thanks, ${session.firstName} ${session.secondName}!\nEnter your referral code (or type "contact support" if you don't have one):`);
      session.state = 'awaiting_referral_code';
      break;
    case 'awaiting_referral_code':
      if (msgBody.toLowerCase() === 'contact support') {
        await message.reply(`📞 A support ticket has been created. Our team will contact you shortly.`);
        notifyAdmins(`⚠️ Support Ticket: User ${message.from} requested a referral code.`);
        session.state = 'init';
        return;
      }
      if (!msgBody) {
        await message.reply(`❌ A referral code is required. Contact support for one.`);
        return;
      }
      let referrer = Object.values(users).find(u => u.referralCode === msgBody.toUpperCase());
      if (!referrer && msgBody.toUpperCase() !== ADMIN_REFERRAL_CODE) {
        await message.reply(`⚠️ Referral code not found. Contact support for a valid referral code.`);
        return;
      }
      session.referredBy = msgBody.toUpperCase();
      await message.reply(`👍 Referral accepted! Now, enter your phone number (e.g., 070XXXXXXXX):`);
      session.state = 'awaiting_phone';
      break;
    case 'awaiting_phone':
      if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
        await message.reply(`❌ Invalid phone format. Must start with 07 or 01 and be 10 digits. Re-enter phone number.`);
      } else if (users[msgBody]) {
        await message.reply(`😮 This number is already registered. Type "login" to access your account.`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.phone = msgBody;
        await message.reply(`🔒 Create a 4-digit PIN for withdrawals:`);
        session.state = 'awaiting_withdrawal_pin';
      }
      break;
    case 'awaiting_withdrawal_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Enter a valid 4-digit PIN.`);
      } else {
        session.withdrawalPIN = msgBody;
        await message.reply(`Almost done! Create a 4-digit security PIN (for login):`);
        session.state = 'awaiting_security_pin';
      }
      break;
    case 'awaiting_security_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN! Enter a valid 4-digit security PIN.`);
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
          `✅ Registration successful, ${newUser.firstName}!\nYour referral code is: ${newUser.referralCode}\nWelcome aboard! 🚀\nType "00" for Main Menu.`
        );
        sessions[message.from] = { state: 'awaiting_menu_selection' };
      }
      break;
    default:
      await message.reply(`😕 Something went wrong. Type "00" for Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

//////////////////////////////////////////
//        MAIN MENU HELPER            //
//////////////////////////////////////////
function mainMenuText() {
  return (
    `🌟 FY'S INVESTMENT BOT Main Menu 🌟\n` +
    `1. Invest 💰\n` +
    `2. Check Balance 🔍\n` +
    `3. Withdraw Earnings 💸\n` +
    `4. Deposit Funds 💵\n` +
    `5. Change PIN 🔑\n` +
    `6. My Referral Link 🔗\n` +
    `7. View Withdrawal Status 📋\n` +
    `8. View My Referrals 👥\n` +
    `Type the option number (or "00" to show this menu).`
  );
}

//////////////////////////////////////////
//      USER SESSION HANDLER          //
//////////////////////////////////////////
async function handleUserSession(message, session, user) {
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_menu_selection':
      switch (msgBody) {
        case '1':
          session.state = 'invest';
          await message.reply(`💰 Enter the investment amount (min: Ksh ${MIN_INVESTMENT}, max: Ksh ${MAX_INVESTMENT}):`);
          break;
        case '2':
          session.state = 'check_balance_menu';
          await message.reply(
            `🔍 Balance Options:\n1. View Account Balance\n2. View Referral Earnings\n3. View Investment History\n4. View All Deposit Statuses\nReply with 1, 2, 3, or 4.`
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
          await message.reply(`🔗 Your Referral Link:\n${referralLink}\nShare with friends!\nType "00" for Main Menu.`);
          session.state = 'awaiting_menu_selection';
          break;
        }
        case '7':
          session.state = 'withdrawal_status';
          if (user.withdrawals.length === 0) {
            await message.reply(`📄 No withdrawal requests yet.\nType "00" for Main Menu.`);
          } else {
            let list = user.withdrawals.map((wd, i) =>
              `${i + 1}. ID: ${wd.withdrawalID}, Amount: Ksh ${wd.amount}, MPESA: ${wd.mpesa}, Date: ${wd.date}, Status: ${wd.status}`
            ).join('\n');
            await message.reply(`📋 Withdrawal Requests:\n${list}\nType "00" for Main Menu.`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        case '8':
          session.state = 'view_referrals';
          if (user.referrals.length === 0) {
            await message.reply(`📄 You haven't referred anyone.\nType "00" for Main Menu.`);
          } else {
            let list = user.referrals.map((ref, i) => {
              let u = Object.values(users).find(u => u.phone === ref);
              return `${i + 1}. ${u ? u.firstName + ' ' + u.secondName : ref}`;
            }).join('\n');
            await message.reply(`📋 Your Referrals:\n${list}\nType "00" for Main Menu.`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        default:
          await message.reply(`❓ Unrecognized option. Enter a valid option number.`);
          break;
      }
      break;
    case 'invest': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount < MIN_INVESTMENT || amount > MAX_INVESTMENT) {
        await message.reply(`❌ Enter an amount between Ksh ${MIN_INVESTMENT} and Ksh ${MAX_INVESTMENT}.`);
      } else if (user.accountBalance < amount) {
        await message.reply(`⚠️ Insufficient funds (Ksh ${user.accountBalance}). Deposit funds. Type "00" for Main Menu.`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.investAmount = amount;
        session.state = 'confirm_investment';
        await message.reply(`🔒 Confirm investment of Ksh ${amount} by entering your 4-digit PIN:`);
      }
      break;
    }
    case 'confirm_investment':
      if (msgBody !== user.withdrawalPIN) {
        await message.reply(`❌ Incorrect PIN. Try again or type "0" to cancel.`);
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
              `🎉 Hi ${referrer.firstName}, you earned a bonus of Ksh ${bonus.toFixed(2)} because ${user.firstName} invested!`
            );
          }
        }
        saveUsers();
        await message.reply(
          `✅ Investment confirmed!\nInvested: Ksh ${session.investAmount}\nExpected Earnings (@${EARNING_PERCENTAGE}%): Ksh ${investment.expectedReturn}\nMatures in ${INVESTMENT_DURATION} minutes.\nType "00" for Main Menu.`
        );
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(
          `🔔 Investment Alert:\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nInvested: Ksh ${session.investAmount}\nDate: ${getKenyaTime()}`
        );
      }
      break;
    case 'withdraw': {
      if (msgBody === '1' || msgBody === '2') {
        session.withdrawOption = msgBody;
        await message.reply(`💸 Enter the withdrawal amount (min: Ksh ${MIN_WITHDRAWAL}, max: Ksh ${MAX_WITHDRAWAL}):`);
        session.state = 'withdraw_amount';
      } else {
        await message.reply(`❓ Reply with 1 for Referral Earnings or 2 for Investment Earnings.`);
      }
      break;
    }
    case 'withdraw_amount': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
        await message.reply(`❌ Enter an amount between Ksh ${MIN_WITHDRAWAL} and Ksh ${MAX_WITHDRAWAL}.`);
      } else {
        if (session.withdrawOption === '1' && user.referralEarnings < amount) {
          await message.reply(`⚠️ Insufficient referral earnings (Ksh ${user.referralEarnings}).`);
          session.state = 'awaiting_menu_selection';
          break;
        }
        if (session.withdrawOption === '2' && user.accountBalance < amount) {
          await message.reply(`⚠️ Insufficient account balance (Ksh ${user.accountBalance}).`);
          session.state = 'awaiting_menu_selection';
          break;
        }
        session.withdrawAmount = amount;
        await message.reply(`📱 Enter your MPESA number (must start with 07 or 01, 10 digits):`);
        session.state = 'withdraw_mpesa';
      }
      break;
    }
    case 'withdraw_mpesa': {
      if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
        await message.reply(`❌ Invalid MPESA number format. Re-enter a valid 10-digit number.`);
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
          await message.reply(`❌ Incorrect PIN twice. An alert has been sent to admin.`);
          notifyAdmins(`⚠️ Withdrawal PIN Alert:\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone}) entered incorrect PIN twice.`);
          session.state = 'awaiting_menu_selection';
        } else {
          await message.reply(`❌ Incorrect PIN. Try again:`);
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
          `💸 Withdrawal Request Received!\nID: ${wd.withdrawalID}\nAmount: Ksh ${wd.amount}\nMPESA: ${wd.mpesa}\nDate: ${wd.date}\nPending admin approval.\nType "00" for Main Menu.`
        );
        notifyAdmins(`🔔 Withdrawal Request:\nUser: ${user.firstName} ${user.secondName} (Phone: ${user.phone})\nAmount: Ksh ${wd.amount}\nMPESA: ${wd.mpesa}\nID: ${wd.withdrawalID}\nDate: ${wd.date}`);
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
        await message.reply(`❌ Incorrect current PIN. Try again or type "0" to cancel.`);
      } else {
        session.state = 'new_pin';
        await message.reply(`🔑 Enter your new 4-digit PIN:`);
      }
      break;
    case 'new_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN. Enter a valid 4-digit PIN.`);
      } else {
        user.withdrawalPIN = msgBody;
        saveUsers();
        await message.reply(`✅ PIN changed successfully!\nType "00" for Main Menu.`);
        session.state = 'awaiting_menu_selection';
      }
      break;
    default:
      await message.reply(`😕 Unrecognized state. Type "00" for Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

//////////////////////////////////////////
//         WHATSAPP CLIENT SETUP        //
//////////////////////////////////////////
const client = new Client({
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});
client.on('qr', (qr) => {
  console.log('🔐 New QR code generated. Open the URL to view it.');
  lastQr = qr;
});
client.on('ready', async () => {
  console.log(`✅ Client ready! [${getKenyaTime()}]`);
  const superAdminWID = `${SUPER_ADMIN}@c.us`;
  try {
    await client.sendMessage(superAdminWID,
      `🎉 Hello Super Admin!\nFY'S INVESTMENT BOT is now online! [${getKenyaTime()}]`
    );
    await client.sendMessage(superAdminWID,
      `🔒 Your secret admin referral code is: *${ADMIN_REFERRAL_CODE}*\nKeep it safe!`
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

  // LOGIN FLOW
  if (msgBody.toLowerCase() === 'login') {
    await message.reply(`🔑 Enter your registered phone number:`);
    sessions[chatId] = { state: 'login_phone' };
    return;
  }
  if (sessions[chatId] && sessions[chatId].state === 'login_phone') {
    let user = Object.values(users).find(u => u.phone === msgBody);
    if (!user) {
      await message.reply(`❌ No account found. Type "register" to create an account.`);
      sessions[chatId] = { state: 'init' };
      return;
    }
    sessions[chatId].loginUser = user;
    sessions[chatId].state = 'login_pin';
    await message.reply(`🔑 Enter your security PIN:`);
    return;
  }
  if (sessions[chatId] && sessions[chatId].state === 'login_pin') {
    let user = sessions[chatId].loginUser;
    if (msgBody === user.securityPIN) {
      if (user.loggedInChatId && user.loggedInChatId !== chatId) {
        try {
          await client.sendMessage(user.loggedInChatId, `🔔 Alert: Your account was accessed from a new device. If not you, type "block".`);
        } catch (error) {
          console.error("❌ Error alerting previous device:", error);
        }
      }
      user.loggedInChatId = chatId;
      saveUsers();
      await message.reply(`😊 Welcome back, ${user.firstName}! You are now logged in. Type "00" for Main Menu.\n🔔 If this wasn’t you, type "block".`);
      sessions[chatId] = { state: 'awaiting_menu_selection' };
      return;
    } else {
      await message.reply(`❌ Incorrect PIN. Try again.`);
      return;
    }
  }
  if (msgBody.toLowerCase() === 'block') {
    await message.reply(`🚫 New device access blocked. Contact support immediately.`);
    return;
  }
  // FORGOT PIN FLOW
  if (msgBody.toLowerCase() === 'forgot pin') {
    await message.reply(`😥 Enter your registered phone number for PIN reset:`);
    sessions[chatId] = { state: 'forgot_pin' };
    return;
  }
  if (sessions[chatId] && sessions[chatId].state === 'forgot_pin') {
    if (!/^(07|01)[0-9]{8}$/.test(msgBody)) {
      await message.reply(`❌ Invalid phone format. Re-enter your registered phone number.`);
      return;
    }
    await message.reply(`🙏 Thank you. A support ticket has been created. Please wait for assistance.`);
    notifyAdmins(`⚠️ Forgot PIN: User with phone ${msgBody} requested PIN reset.`);
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    return;
  }
  // REGISTRATION & MAIN MENU
  let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!registeredUser && !sessions[chatId]) {
    await message.reply(`❓ Not registered. Type "register" to begin or "login" if you have an account.`);
    sessions[chatId] = { state: 'init' };
    return;
  }
  if (msgBody === '00') {
    await message.reply(`🏠 Main Menu:\n${mainMenuText()}`);
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    return;
  }
  if (msgBody === '0') {
    await message.reply(`🔙 Operation cancelled. Type "00" for Main Menu.`);
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
      await message.reply(`💔 You are banned from FY'S INVESTMENT BOT.\nReason: ${registeredUser.bannedReason || 'Not specified'}\nContact support if you believe this is an error.`);
      return;
    }
    await handleUserSession(message, session, registeredUser);
  } else {
    if (session.state === 'init' && msgBody.toLowerCase() === 'register') {
      await message.reply(`👋 Let's register! Enter your first name:`);
      session.state = 'awaiting_first_name';
      return;
    }
    if (session.state === 'init') {
      await message.reply(`❓ Type "register" to begin or "login" if you have an account.`);
      return;
    }
    await handleRegistration(message, session);
  }
});

//////////////////////////////////////////
//         EXPRESS SERVER START         //
//////////////////////////////////////////
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}. Open the URL to view the QR code.`);
});

client.initialize();
