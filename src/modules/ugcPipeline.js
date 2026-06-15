const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const db = require('./db');
const { notifyTelegram } = require('./telegram');
const { fetchBestDeals } = require('./shopee');

const CHARACTER_ENGINE_DIR = 'c:/2 - PERSONAGENS/character-engine';
const GI_CHARACTER_NAME = 'Gi - Organize e Poupe';
const GI_CHARACTER_DIR = path.join(CHARACTER_ENGINE_DIR, 'characters', GI_CHARACTER_NAME);
const GI_OUTPUT_DIR = path.join(CHARACTER_ENGINE_DIR, 'output', GI_CHARACTER_NAME);

// Helper para executar comandos python no diretório do character-engine
function runPythonCommand(command, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const fullEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', ...envOverrides };
    // Forçar a KEY do ElevenLabs e Fal para o Python se estiverem no process.env do Node
    if (process.env.FAL_KEY) fullEnv.FAL_KEY = process.env.FAL_KEY;
    if (process.env.OPENAI_API_KEY) fullEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (process.env.ELEVENLABS_API_KEY) fullEnv.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

    console.log(`[UGC Pipeline] Executando: ${command}`);
    exec(command, { cwd: CHARACTER_ENGINE_DIR, env: fullEnv }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[UGC Pipeline] Erro ao rodar comando: ${command}`, stderr || error.message);
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

// Auxiliar para adicionar o produto como tópico no topics.yaml
function appendTopicToYaml(product, id) {
  const topicsPath = path.join(GI_CHARACTER_DIR, 'topics.yaml');
  let content = '';
  if (fs.existsSync(topicsPath)) {
    content = fs.readFileSync(topicsPath, 'utf8');
  }

  const escapeString = (str) => {
    if (!str) return '';
    return str.replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
  };

  const discountText = product.discountPct ? ` com ${product.discountPct}% de desconto` : '';
  const priceText = product.price ? ` R$ ${product.price.toFixed(2)}` : ' preço imbatível';
  
  // Detalhes do produto para o GPT-4o
  const angle = `Produto: ${product.name}. Preço anterior: R$ ${product.originalPrice || 'n/a'}. Preço atual: R$ ${product.price || 'n/a'}. Desconto: ${product.discountPct || 0}%. Link: ${product.affiliateLink}.`;
  
  // CTA da Gi
  const cta = `e tá saindo por apenas ${priceText}! o link com desconto tá na bio, corre pra garantir!`;

  const entry = `
  - id: "${id}"
    title: "${escapeString(product.name)}"
    pillar: "promocao"
    hook: "olha o que eu achei na shopee gente"
    angle: "${escapeString(angle)}"
    cta: "${escapeString(cta)}"
    status: "pending"
`;

  if (!content.includes('topics:')) {
    fs.writeFileSync(topicsPath, `topics:${entry}`, 'utf8');
  } else {
    fs.appendFileSync(topicsPath, entry, 'utf8');
  }
  console.log(`[UGC Pipeline] Tópico adicionado ao topics.yaml para o ID ${id}`);
}

// Orquestrador da geração de vídeo (Assíncrono em background)
async function triggerUGCGeneration(product) {
  const id = db.addUgcVideo(product);
  console.log(`[UGC Pipeline] Iniciando pipeline para o vídeo ID: ${id}`);
  
  // Processamento assíncrono em background
  (async () => {
    try {
      notifyTelegram(`🎬 *Gi UGC Pipeline Iniciado*\nProduto: ${product.name.substring(0, 50)}...\nStatus: Gerando roteiro e áudio...`);
      
      // 1. Registrar tópico
      appendTopicToYaml(product, id);
      db.updateUgcVideo(id, { status: 'generating' });

      // 2. Executar generate_character.py para criar áudio e vídeo base
      // Passamos a ELEVENLABS_API_KEY no environment
      const env = {};
      if (process.env.ELEVENLABS_API_KEY) {
        env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
      }
      
      console.log('[UGC Pipeline] Gerando vídeo base com Kling...');
      notifyTelegram(`🎥 *Gi UGC Pipeline* [2/4]\nSubmetendo imagem e áudio para o Kling AI (fal.ai)...`);
      
      await runPythonCommand(`python generate_character.py -c "${GI_CHARACTER_NAME}" --topic "${id}"`, env);

      // Caminhos dos arquivos gerados
      const baseVideoPath = path.join(GI_OUTPUT_DIR, `${id}_final.mp4`);
      const baseAudioPath = path.join(GI_OUTPUT_DIR, `${id}_voice.mp3`);
      const captionPath = path.join(GI_OUTPUT_DIR, `${id}_caption.txt`);

      if (!fs.existsSync(baseVideoPath) || !fs.existsSync(baseAudioPath)) {
        throw new Error('Vídeo ou áudio base não foi gerado pelo character-engine.');
      }

      // 3. Executar post_process.py para adicionar legendas, hook e thumbnail
      // Definimos UPLOAD_POST_KEY vazio para impedir publicação automática nesta etapa
      console.log('[UGC Pipeline] Iniciando pós-processamento (FFmpeg & Whisper)...');
      notifyTelegram(`✏️ *Gi UGC Pipeline* [3/4]\nTranscrevendo áudio com Whisper e aplicando legendas...`);

      const hookText = "olha o que eu achei!";
      const finalOutputDir = path.join(GI_OUTPUT_DIR, 'final');
      
      // Comando do post_process: python post_process.py <video> <audio> <hook_text> <output_dir> [caption_file]
      await runPythonCommand(
        `python post_process.py "${baseVideoPath.replace(/\\/g, '/')}" "${baseAudioPath.replace(/\\/g, '/')}" "${hookText}" "${finalOutputDir.replace(/\\/g, '/')}" "${captionPath.replace(/\\/g, '/')}"`,
        { UPLOAD_POST_KEY: "" } // Força vazio para não publicar
      );

      const finalVideoPath = path.join(finalOutputDir, `${id}_final_pub.mp4`);
      const finalThumbPath = path.join(finalOutputDir, `${id}_thumb.jpg`);
      const srtPath = path.join(finalOutputDir, `${id}.srt`);
      
      let caption = '';
      if (fs.existsSync(captionPath)) {
        caption = fs.readFileSync(captionPath, 'utf8').trim();
      }

      if (!fs.existsSync(finalVideoPath)) {
        throw new Error('Vídeo final pós-processado não encontrado.');
      }

      // 4. Salvar resultados no banco e notificar aprovação
      db.updateUgcVideo(id, {
        status: 'pending_approval',
        video_path: finalVideoPath,
        thumbnail_path: finalThumbPath,
        srt_path: srtPath,
        caption: caption
      });

      console.log(`[UGC Pipeline] Vídeo gerado com sucesso! ID: ${id}`);
      
      // Envia notificação com o vídeo para aprovação rápida
      notifyTelegram(`✅ *Vídeo UGC da Gi Pronto!*\n\n*Produto:* ${product.name}\n*Legenda:* \n\`\`\`\n${caption}\n\`\`\`\n\nUse o painel no Telegram para assistir e postar.`);
      
    } catch (err) {
      console.error(`[UGC Pipeline] Falha na geração para o ID ${id}:`, err.message);
      db.updateUgcVideo(id, { status: 'failed' });
      notifyTelegram(`❌ *Falha no UGC Pipeline da Gi*\nErro: ${err.message}`);
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
