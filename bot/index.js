import 'dotenv/config';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';

const { BOT_TOKEN, WEBAPP_URL, PORT = 8080 } = process.env;
if (!BOT_TOKEN || !WEBAPP_URL) {
  console.error('Missing BOT_TOKEN or WEBAPP_URL in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// /start — клавиатура c WebApp-кнопкой
bot.start((ctx) => ctx.reply(
  'Добро пожаловать! Нажми "Games" чтобы открыть мини-игры.',
  Markup.keyboard([ Markup.button.webApp('🎮 Games', WEBAPP_URL) ]).resize()
));

// приём данных из WebApp (sendData)
bot.on('web_app_data', async (ctx) => {
  try {
    const raw = ctx.message.web_app_data?.data || '{}';
    const payload = JSON.parse(raw);
    console.log('WEBAPP DATA:', payload);
    await ctx.reply(`Результат принят: ${payload.game ?? 'game'} — ${payload.score ?? '?'} очков`);
  } catch (e) { console.error(e); }
});

// healthcheck для хостинга
const app = express();
app.get('/', (_, res) => res.send('Bot is running.'));
app.listen(PORT, () => console.log('HTTP server on :' + PORT));

bot.launch().then(() => console.log('Bot started'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
