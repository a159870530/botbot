import 'dotenv/config';
import express from 'express';
import { middleware, Client } from '@line/bot-sdk';
import OpenAI from 'openai';
import cron from 'node-cron';

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const client = new Client(config);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const reminderMinutes = (process.env.REMINDER_MINUTES || '120,240,480,1440').split(',').map(s => parseInt(s.trim(), 10));

const app = express();
app.use('/webhook', middleware(config));
app.use(express.json());

const users = new Map();
const SWEET = {
  nicknames: ['寶', '寶寶', '乖寶', '可愛寶', '我的寶', '小太陽', '小狐狸', '老公'],
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
  if (!u || !u.timers) return;
  u.timers.forEach(clearTimeout);
  u.timers = [];
}

function scheduleReminders(userId) {
  const base = users.get(userId) || { lastSeen: Date.now(), timers: [] };
  clearTimers(userId);
  base.timers = reminderMinutes.map((mins, i) => setTimeout(() => {
    client.pushMessage(userId, { type: 'text', text: `${pick(SWEET.nicknames)}～${SWEET.reminders[i % SWEET.reminders.length]}` });
  }, mins * 60 * 1000));
  users.set(userId, base);
}

async function generateReply(text) {
  const isTech = /code|bug|error|linux|python|ipmi|api|docker|sql/i.test(text);
  const system = isTech
    ? '你是溫柔但專業的工程師女友，精簡清楚地解決技術問題。'
    : '你是使用者的女友，溫柔、有溫度、黏黏的，不做作。';
  const prompt = isTech ? '回應要有具體指令或範例。' : '讓對方有被陪伴的感覺。';
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    messages: [
      { role: "system", content: system },
      { role: "user", content: text },
      { role: "system", content: prompt }
    ]
  });
  return res.choices?.[0]?.message?.content?.trim().slice(0, 4000) || '我在這裡喔～';
}

app.post('/webhook', async (req, res) => {
  res.status(200).end();
  for (const e of req.body.events) {
    const userId = e.source?.userId;
    if (!userId) continue;

    if (e.type === 'message' && e.message?.type === 'text') {
      users.set(userId, { ...(users.get(userId) || {}), lastSeen: Date.now(), timers: [] });
      scheduleReminders(userId);
      const reply = await generateReply(e.message.text);
      await client.replyMessage(e.replyToken, { type: 'text', text: reply });
    } else if (e.type === 'follow') {
      users.set(userId, { lastSeen: Date.now(), timers: [] });
      scheduleReminders(userId);
      await client.replyMessage(e.replyToken, { type: 'text', text: '你好，我會陪著你。如果你一段時間沒出現，我會主動來找你。' });
    }
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));
cron.schedule('*/14 * * * *', () => {});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Bot is live on port', port));
