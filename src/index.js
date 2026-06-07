require('dotenv').config();
const express = require('express');

const { initDB } = require('./modules/db');
const { initTelegram } = require('./modules/telegram');
const { initScheduler } = require('./modules/scheduler');

// =============================================
// VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE
// =============================================
const REQUIRED_ENV = [
  'OPENAI_API_KEY',
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET',
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'SHOPEE_APP_ID',
  'SHOPEE_SECRET_KEY',
  'SHOPEE_ACCESS_TOKEN',
];

const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ Variáveis de ambiente ausentes:', missing.join(', '));
  process.exit(1);
}

// =============================================
// INICIALIZAÇÃO
// =============================================
async function main() {
  console.log('🚀 Iniciando Organize-se Bot...');

  // 1. Banco de dados
  initDB();

  // 2. Telegram (cockpit operacional)
  initTelegram();

  // 3. Agendador automático
  initScheduler();

  // 4. Servidor HTTP (health check para Railway)
  const app = express();
  const PORT = process.env.PORT || 8080;

  app.get('/health', (req, res) => {
    const { getPendingCount, getTodayCount } = require('./modules/db');
    res.json({
      status: 'ok',
      bot: 'Organize-se',
      uptime: process.uptime(),
      queue: getPendingCount(),
      postsToday: getTodayCount(),
      maxDaily: parseInt(process.env.MAX_DAILY_POSTS || '6'),
    });
  });

  app.listen(PORT, () => {
    console.log(`[HTTP] Health check em http://localhost:${PORT}/health`);
  });

  console.log('✅ Organize-se Bot online e rodando!');
}

main().catch(err => {
  console.error('❌ Erro fatal na inicialização:', err);
  process.exit(1);
});
