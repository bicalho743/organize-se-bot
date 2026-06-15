const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const db = require('./db');
const { notifyTelegram } = require('./telegram');
const { fetchBestDeals } = require('./shopee');

// Orquestrador da geração de vídeo via API HTTP do character-engine (Assíncrono)
async function triggerUGCGeneration(product) {
  const id = db.addUgcVideo(product);
  console.log(`[UGC Pipeline] Iniciando pipeline via API para o vídeo ID: ${id}`);
  
  const characterEngineUrl = process.env.CHARACTER_ENGINE_URL || 'http://localhost:8000';
  const botUrl = process.env.BOT_URL || 'http://localhost:8080';
  const webhookUrl = `${botUrl}/ugc-webhook`;
  
  // Executa em background para não travar a resposta imediata
  (async () => {
    try {
      notifyTelegram(`🎬 *Gi UGC Pipeline Iniciado*\nProduto: ${product.name.substring(0, 50)}...\nStatus: Enviando solicitação para o servidor de vídeo...`);
      
      db.updateUgcVideo(id, { status: 'generating' });
      
      const payload = {
        job_id: id,
        product: {
          name: product.name,
          price: product.price !== undefined ? product.price : null,
          originalPrice: product.originalPrice !== undefined ? product.originalPrice : null,
          discountPct: product.discountPct !== undefined ? product.discountPct : null,
          affiliateLink: product.affiliateLink,
          imageUrl: product.imageUrl || null,
          category: product.category || null
        },
        webhook_url: webhookUrl
      };

      console.log(`[UGC Pipeline] Enviando POST para ${characterEngineUrl}/api/character/generate-ugc`);
      
      const response = await axios.post(`${characterEngineUrl}/api/character/generate-ugc`, payload);
      
      if (response.status === 200 || response.status === 202 || response.status === 201) {
        console.log(`[UGC Pipeline] Solicitação aceita pelo servidor. Job ID: ${id}`);
      } else {
        throw new Error(`Servidor de vídeo retornou status ${response.status}: ${JSON.stringify(response.data)}`);
      }
      
    } catch (err) {
      console.error(`[UGC Pipeline] Falha ao iniciar geração para o ID ${id}:`, err.message);
      db.updateUgcVideo(id, { status: 'failed' });
      notifyTelegram(`❌ *Falha no UGC Pipeline da Gi*\nErro ao se conectar com o servidor de vídeo: ${err.message}`);
    }
  })();

  return id;
}

// Publica o vídeo gerado via Upload-Post API
async function publishUGCVideo(id) {
  const item = db.getUgcVideoById(id);
  if (!item) throw new Error('Vídeo não encontrado no banco de dados.');
  if (!item.video_path || !fs.existsSync(item.video_path)) {
    throw new Error('Arquivo de vídeo não encontrado no disco.');
  }

  const uploadKey = process.env.UPLOAD_POST_KEY;
  if (!uploadKey) {
    throw new Error('UPLOAD_POST_KEY não configurada no ambiente.');
  }

  db.updateUgcVideo(id, { status: 'posting' });
  notifyTelegram(`📤 Publicando vídeo UGC da Gi para o TikTok e Instagram Reels...`);

  try {
    const videoBytes = fs.readFileSync(item.video_path);
    const form = new FormData();
    form.append('video', videoBytes, {
      filename: path.basename(item.video_path),
      contentType: 'video/mp4'
    });

    const profile = process.env.UPLOAD_POST_USER_GI || 'GiOrganizeEPoupe';
    form.append('user', profile);
    form.append('title', item.caption);
    form.append('description', item.caption);
    form.append('platform[]', 'instagram');
    form.append('platform[]', 'tiktok');
    form.append('media_type', 'REELS');
    form.append('share_to_feed', 'true');
    form.append('tiktok_ai_generated_content', 'true');
    form.append('post_mode', 'DIRECT_POST');

    console.log(`[UGC Pipeline] Enviando para Upload-Post para o perfil: ${profile}...`);
    
    const response = await axios.post('https://api.upload-post.com/api/upload', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Apikey ${uploadKey}`
      },
      timeout: 180000 // 3 minutos de timeout para upload
    });

    if (response.status === 200 || response.status === 201 || response.status === 202) {
      db.updateUgcVideo(id, { status: 'posted', posted_at: new Date().toISOString() });
      notifyTelegram(`🎉 *Vídeo UGC publicado com sucesso!* (Perfil: ${profile})`);
      return { success: true, response: response.data };
    } else {
      throw new Error(`Upload-Post retornou status ${response.status}: ${JSON.stringify(response.data)}`);
    }
  } catch (err) {
    console.error(`[UGC Pipeline] Erro ao publicar vídeo ${id}:`, err.message);
    db.updateUgcVideo(id, { status: 'failed' });
    notifyTelegram(`❌ *Falha ao publicar vídeo UGC no Instagram/TikTok*\nErro: ${err.message}`);
    throw err;
  }
}

// Cron diário: busca produtos Shopee e seleciona a melhor promoção para gerar UGC
async function autoFetchAndTriggerUGC() {
  console.log('[UGC Pipeline] Cron diário: Selecionando produto para vídeo UGC da Gi...');
  try {
    const deals = await fetchBestDeals(15);
    if (deals.length === 0) {
      console.log('[UGC Pipeline] Nenhum produto disponível hoje.');
      return;
    }

    // Filtra promoções que já tiveram UGC postado recentemente
    const candidateDeals = [];
    for (const deal of deals) {
      const posted = db.wasUgcPostedRecently(deal.name, 48); // 48 horas
      if (!posted) {
        candidateDeals.push(deal);
      }
    }

    if (candidateDeals.length === 0) {
      console.log('[UGC Pipeline] Todos os candidatos já foram postados recentemente.');
      return;
    }

    // Seleciona a melhor oferta (maior desconto primeiro)
    candidateDeals.sort((a, b) => b.discountPct - a.discountPct);
    const bestDeal = candidateDeals[0];

    console.log(`[UGC Pipeline] Melhor oferta selecionada para UGC: ${bestDeal.name} (-${bestDeal.discountPct}%)`);
    await triggerUGCGeneration(bestDeal);
  } catch (err) {
    console.error('[UGC Pipeline] Erro no cron diário do UGC:', err.message);
  }
}

module.exports = {
  triggerUGCGeneration,
  publishUGCVideo,
  autoFetchAndTriggerUGC
};
