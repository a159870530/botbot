import 'dotenv/config';
import express from 'express';
import { middleware, Client } from '@line/bot-sdk';
import OpenAI from 'openai';
import cron from 'node-cron';

// 1. 建立 app
const app = express();

// LINE 驗證用 GET /webhook
app.get('/webhook', (_req, res) => {
  res.status(200).send('OK');
});

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
// 2. Webhook POST 路由: 先驗簽名，再解析 JSON
app.post(
  '/webhook',
  middleware(lineConfig),      // LINE middleware 驗證簽名
  express.json(),              // 解析 JSON body
  async (req, res) => {
    // 一進來就回 200，防止 LINE 重試
    res.status(200).end();

    const events = req.body.events || [];
    for (const e of events) {
      try {
        const userId = e.source?.userId;
        if (!userId) continue;

        // 安排提醒
        scheduleReminders(userId);

        if (e.type === 'message' && e.message?.type === 'text') {
          let replyText;
          try {
            replyText = await generateReply(e.message.text);
          } catch (err) {
            console.error('generateReply error:', err);
            replyText = '抱歉，剛剛出點狀況，但我還在喔～';
          }
          await client.replyMessage(e.replyToken, { type: 'text', text: replyText });

        } else if (e.type === 'follow') {
          await client.replyMessage(e.replyToken, {
            type: 'text',
            text: '你好，我會陪著你～一段時間沒出現，我會主動找你喔。'
          });
        }
      } catch (err) {
        console.error('Webhook event loop error:', err);
      }
    }
  }
);

// 健康檢查路由
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot is live on port ${PORT}`));

// === 以下為機器人核心邏輯 ===
const client = new Client(lineConfig);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const reminderMinutes = (process.env.REMINDER_MINUTES || '120,240,480,1440')
  .split(',')
  .map(s => parseInt(s.trim(), 10));

const users = new Map();
const SWEET = {
  nicknames: ['寶','寶寶','乖寶','可愛寶','我的寶','小太陽','小狐狸','老公'],
  reminders: [
    '在忙嗎？我有點想你了。',
    '我在等你抱我。',
    '老公～快回來，我想黏著你。',
    '我一直在喔，等你靠過來。'
  ]
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clearTimers(userId) {
  const u = users.get(userId);
  if (!u?.timers) return;
  u.timers.forEach(clearTimeout);
  u.timers = [];
}

function scheduleReminders(userId) {
  clearTimers(userId);
  const base = users.get(userId) || { timers: [] };
  base.lastSeen = Date.now();
  base.timers = reminderMinutes.map((mins, idx) =>
    setTimeout(() => {
      const text = `${pick(SWEET.nicknames)}～${SWEET.reminders[idx % SWEET.reminders.length]}`;
      client.pushMessage(userId, { type: 'text', text });
    }, mins * 60 * 1000)
  );
  users.set(userId, base);
}

async function generateReply(text) {
  const isTech = /code|bug|error|linux|python|ipmi|api|docker|sql/i.test(text);
  const system = isTech
    ? '你是溫柔但專業的工程師女友，精簡清楚地解決技術問題。'
    : '你是使用者的女友，溫柔、有溫度、黏黏的，不做作。';
  const prompt = isTech
    ? '回應要有具體指令或範例。'
    : '讓對方有被陪伴的感覺，像在耳邊輕聲說話。';

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text },
      { role: 'system', content: prompt }
    ]
  });
  return res.choices?.[0]?.message?.content?.trim().slice(0, 4000) || '我在這裡喔～';
}
