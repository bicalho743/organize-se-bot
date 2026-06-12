require('dotenv').config();
const express = require('express');

const { initDB } = require('./modules/db');
const { initTelegram } = require('./modules/telegram');
const { initScheduler } = require('./modules/scheduler');
const { initTwitter } = require('./modules/twitter');
const { initMentions } = require('./modules/mentions');

// =============================================
// VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE
// =============================================
const REQUIRED_ENV = [
  'OPENAI_API_KEY',
  'TWITTER_OAUTH2_ACCESS_TOKEN',
  
  
  
  
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];

// Shopee é opcional — bot funciona sem ela via posts manuais pelo Telegram
const OPTIONAL_SHOPEE = ['SHOPEE_APP_ID', 'SHOPEE_SECRET_KEY', 'SHOPEE_ACCESS_TOKEN'];

const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ Variáveis de ambiente ausentes:', missing.join(', '));
  process.exit(1);
}

const shopeeConfigured = OPTIONAL_SHOPEE.every(key => process.env[key]);
if (!shopeeConfigured) {
  console.warn('⚠️  Shopee API não configurada. Busca automática desativada.');
  console.warn('   Configure SHOPEE_APP_ID, SHOPEE_SECRET_KEY e SHOPEE_ACCESS_TOKEN para ativar.');
}

// =============================================
// INICIALIZAÇÃO
// =============================================
async function main() {
  console.log('🚀 Iniciando Organize-se Bot...');

  // 1. Banco de dados
  await initDB();

  // 2. Telegram (cockpit operacional)
  await initTwitter();
  initTelegram();

  // 3. Agendador automático
  initScheduler();

  // 4. Monitoramento de menções
  initMentions();

  // 4. Servidor HTTP (health check para Railway)
  const app = express();
  const PORT = process.env.PORT || 8080;

  app.get('/health', (req, res) => {
    const { getPendingCount, getTodayCount } = require('./modules/db');
    res.json({
      status: 'ok',
      bot: 'Organize-se',
      shopee: shopeeConfigured ? 'configurada' : 'não configurada',
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
  if (!shopeeConfigured) {
    console.log('💡 Dica: envie promoções manualmente pelo Telegram para começar a postar.');
  }
}

main().catch(err => {
  console.error('❌ Erro fatal na inicialização:', err);
  process.exit(1);
});
