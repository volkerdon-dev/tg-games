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
  '♟️ Добро пожаловать в TG Chess! Нажми "Chess" чтобы играть и учиться.',
  Markup.keyboard([ Markup.button.webApp('♟️ Chess', WEBAPP_URL) ]).resize()
));

// (опционально) команда /chess
bot.command('chess', (ctx) => ctx.reply(
  'Открыть TG Chess:',
  Markup.keyboard([ Markup.button.webApp('♟️ Chess', WEBAPP_URL) ]).resize()
));

// приём данных из WebApp (sendData)
bot.on('web_app_data', async (ctx) => {
  try {
    const raw = ctx.message.web_app_data?.data || '{}';
    const payload = JSON.parse(raw);
    console.log('WEBAPP DATA:', payload);

    // ожидаемые события из WebApp:
    // { type:"lesson_complete", lessonId:"basics-1" }
    // { type:"puzzle_result", puzzleId:"p1", result:"solved/failed", theme:"mate-in-1" }
    // { type:"game_result", mode:"vs_ai_mvp", level:4, side:"white", result:"win/loss/draw", moves:32 }

    if (payload.type === 'lesson_complete') {
      await ctx.reply(`✅ Урок пройден: ${payload.lessonId}`);
      return;
    }

    if (payload.type === 'puzzle_result') {
      await ctx.reply(`🎯 Пазл ${payload.puzzleId}: ${payload.result}${payload.theme ? ` (${payload.theme})` : ''}`);
      return;
    }

    if (payload.type === 'game_result') {
      await ctx.reply(`♟️ Игра завершена: ${payload.result} — ${payload.moves} ход(ов) — lvl ${payload.level ?? '?'}`);
      return;
    }

    // fallback на старый формат (если что-то пришло не по схеме)
    await ctx.reply(`Данные приняты ✅\n${raw}`);
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка обработки данных из WebApp ❌');
  }
});

// healthcheck для хостинга
const app = express();
app.get('/', (_, res) => res.send('Bot is running.'));
app.listen(PORT, () => console.log('HTTP server on :' + PORT));

bot.launch().then(() => console.log('Bot started'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
