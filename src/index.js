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
  const character = process.env.BOT_CHARACTER || 'Gi - Organize e Poupe';
  const charDisplayName = character === 'padre_miguel' ? 'Padre Miguel' : (character === 'Gi - Organize e Poupe' ? 'Gi' : character);

  console.log(`🚀 Iniciando Bot do ${charDisplayName}...`);

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
  app.use(express.json());
  const PORT = process.env.PORT || 8080;

  app.get('/health', (req, res) => {
    const { getPendingCount, getTodayCount } = require('./modules/db');
    res.json({
      status: 'ok',
      bot: charDisplayName,
      shopee: shopeeConfigured ? 'configurada' : 'não configurada',
      uptime: process.uptime(),
      queue: getPendingCount(),
      postsToday: getTodayCount(),
      maxDaily: parseInt(process.env.MAX_DAILY_POSTS || '6'),
    });
  });

  app.post('/ugc-webhook', async (req, res) => {
    const { id, status, video_url, thumbnail_url, caption, error } = req.body;
    console.log(`[Webhook UGC] Recebido para job ${id}. Status: ${status}`);
    
    // Responde imediatamente para liberar o character-engine
    res.json({ received: true });
    
    const db = require('./modules/db');
    const { notifyTelegram, presentUgcForApproval } = require('./modules/telegram');
    const fs = require('fs');
    const path = require('path');
    const axios = require('axios');
    
    const item = db.getUgcVideoById(id);
    if (!item) {
      console.warn(`[Webhook UGC] Job ${id} não encontrado no banco.`);
      return;
    }
    
    if (status === 'failed') {
      db.updateUgcVideo(id, { status: 'failed' });
      notifyTelegram(`❌ *Falha no Pipeline do ${charDisplayName}*\nErro: ${error || 'Desconhecido'}`);
      return;
    }
    
    try {
      notifyTelegram(`📥 *Vídeo Gerado!* Baixando arquivos do vídeo...`);
      
      const tmpDir = path.join(__dirname, '../data/tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      
      const localVideoPath = path.join(tmpDir, `${id}_final.mp4`);
      const localThumbPath = path.join(tmpDir, `${id}_thumb.jpg`);
      
      // Download do Vídeo
      const videoResponse = await axios({
        url: video_url,
        method: 'GET',
        responseType: 'stream'
      });
      const videoWriter = fs.createWriteStream(localVideoPath);
      videoResponse.data.pipe(videoWriter);
      await new Promise((resolve, reject) => {
        videoWriter.on('finish', resolve);
        videoWriter.on('error', reject);
      });
      
      // Download da Thumbnail
      const thumbResponse = await axios({
        url: thumbnail_url,
        method: 'GET',
        responseType: 'stream'
      });
      const thumbWriter = fs.createWriteStream(localThumbPath);
      thumbResponse.data.pipe(thumbWriter);
      await new Promise((resolve, reject) => {
        thumbWriter.on('finish', resolve);
        thumbWriter.on('error', reject);
      });
      
      // Atualiza no banco
      db.updateUgcVideo(id, {
        status: 'pending_approval',
        video_path: localVideoPath,
        thumbnail_path: localThumbPath,
        caption: caption
      });
      
      // Apresenta para aprovação no Telegram
      await presentUgcForApproval(id);
      
    } catch (err) {
      console.error(`[Webhook UGC] Erro ao baixar arquivos do vídeo:`, err.message);
      db.updateUgcVideo(id, { status: 'failed' });
      notifyTelegram(`❌ *Falha ao processar arquivos do vídeo do ${charDisplayName}*\nErro: ${err.message}`);
    }
  });

  app.listen(PORT, () => {
    console.log(`[HTTP] Health check e Webhook em http://localhost:${PORT}`);
  });

  console.log(`✅ Bot do ${charDisplayName} online e rodando!`);
  if (character === 'Gi - Organize e Poupe' && !shopeeConfigured) {
    console.log('💡 Dica: envie promoções manualmente pelo Telegram para começar a postar.');
  } else if (character !== 'Gi - Organize e Poupe') {
    console.log('💡 Dica: envie temas reflexivos no Telegram para começar a gerar vídeos.');
  }
}

main().catch(err => {
  console.error('❌ Erro fatal na inicialização:', err);
  process.exit(1);
});
