# TG Games

Telegram chess mini-app with three parts:

- **Bot** (`/bot`): Telegraf bot that launches the WebApp and receives `web_app_data`.
- **Web** (`/web`): Static WebApp (no build step).
- **API** (`/api`): Vercel Serverless Functions (`.cjs`) for coach review and translations.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   ```
3. Start the bot:
   ```bash
   npm run dev
   ```

The WebApp is static, so you can open `web/chess/index.html` directly or serve the `/web` folder with any static server.

## Environment variables

Required for local bot + production deployments:

- `BOT_TOKEN`: Telegram bot token for Telegraf.
- `WEBAPP_URL`: WebApp URL used in the bot keyboard button.

API/infra variables:

- `OPENAI_API_KEY`: Used by serverless API functions that call OpenAI.
- `ADMIN_TOKEN`: Secures admin/translation API endpoints.
- `ALLOWED_ORIGINS`: Comma-separated list of allowed origins for API access.
- `TG_BOT_TOKEN` or `TELEGRAM_BOT_TOKEN`: Bot token used to validate WebApp `initData` on `/api/coachGameReview`.
- `TG_INITDATA_MAX_AGE_SECONDS`: Optional max age for `initData` (default 86400 seconds).

## Notes

- `/web/app` and `/web/components` contain unused React/Next-era assets; current deployment serves the static files in `/web`.
