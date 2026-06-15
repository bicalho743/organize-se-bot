const TelegramBot = require('node-telegram-bot-api');
const { generatePost, generateReply } = require('./openai');
const { isUrl, extractProductFromUrl, isGarbageName } = require('./linkReader');
const { postTweet, postReply } = require('./twitter');
const db = require('./db');
const { fetchBestDeals } = require('./shopee');

let bot;

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MAX_DAILY_POSTS = parseInt(process.env.MAX_DAILY_POSTS || '6');

function initTelegram() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

  bot.on('polling_error', (err) => {
    console.error('[Telegram] Polling error:', err.message);
  });

  // /start
  bot.onText(/\/start/, (msg) => {
    if (!isAuthorized(msg)) return;
    bot.sendMessage(CHAT_ID,
      '*Organize-se Bot online*\n\n' +
      'Comandos:\n' +
      '/status — situacao do bot\n' +
      '/fila — ver fila pendente\n' +
      '/buscar — buscar promocoes Shopee\n' +
      '/postar — postar proximo da fila\n' +
      '/limite — ver/alterar posts diarios\n' +
      '/post [texto] — post manual no X\n' +
      '/limpar — limpar fila\n\n' +
      'Ou mande um link e eu gero os posts automaticamente.',
      { parse_mode: 'Markdown' }
    );
  });

  // /status
  bot.onText(/\/status/, (msg) => {
    if (!isAuthorized(msg)) return;
    const pending = db.getPendingCount();
    const todayCount = db.getTodayCount();
    const recentPosts = db.getRecentPosts(3);
    let text = '*Status do Bot*\n\n';
    text += 'Posts hoje: ' + todayCount + '/' + MAX_DAILY_POSTS + '\n';
    text += 'Na fila: ' + pending + ' produto(s)\n\n';
    if (recentPosts.length > 0) {
      text += '*Ultimos posts:*\n';
      recentPosts.forEach(function(p) {
        const time = new Date(p.posted_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        text += '* [' + time + '] ' + (p.product_name || '').substring(0, 40) + '\n';
      });
    }
    bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
  });

  // /fila
  bot.onText(/\/fila/, (msg) => {
    if (!isAuthorized(msg)) return;
    const queue = db.getQueueList();
    if (queue.length === 0) {
      bot.sendMessage(CHAT_ID, 'Fila vazia. Use /buscar para trazer promocoes.');
      return;
    }
    let text = '*Fila de posts (' + queue.length + ')*\n\n';
    queue.forEach(function(item, i) {
      const price = item.price ? 'R$' + Number(item.price).toFixed(2) : 'sem preco';
      text += (i + 1) + '. ' + (item.product_name || '').substring(0, 50) + '\n';
      text += '   ' + price + ' (-' + item.discount_pct + '%)\n';
    });
    bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
  });

  // /buscar
  bot.onText(/\/buscar/, async (msg) => {
    if (!isAuthorized(msg)) return;
    bot.sendMessage(CHAT_ID, 'Buscando promocoes na Shopee...');
    try {
      const deals = await fetchBestDeals(8);
      if (deals.length === 0) {
        bot.sendMessage(CHAT_ID, 'Nenhuma promocao qualificada encontrada.');
        return;
      }
      let added = 0;
      for (const product of deals) {
        if (db.wasPostedRecently(product.name)) continue;
        const posts = await generatePost(product);
        db.addToQueue(Object.assign({}, product, { generatedPost: JSON.stringify(posts) }));
        added++;
      }
      bot.sendMessage(CHAT_ID, added + ' produtos adicionados a fila.\nUse /fila ou /postar.');
    } catch (err) {
      bot.sendMessage(CHAT_ID, 'Erro ao buscar: ' + err.message);
    }
  });

  // /postar
  bot.onText(/\/postar/, async (msg) => {
    if (!isAuthorized(msg)) return;
    const todayCount = db.getTodayCount();
    if (todayCount >= MAX_DAILY_POSTS) {
      bot.sendMessage(CHAT_ID, 'Limite diario atingido (' + todayCount + '/' + MAX_DAILY_POSTS + ').');
      return;
    }
    const next = db.getNextInQueue();
    if (!next) {
      bot.sendMessage(CHAT_ID, 'Fila vazia. Use /buscar.');
      return;
    }
    await presentPostForApproval(next);
  });

  // /limite N
  bot.onText(/\/limite (.+)/, (msg, match) => {
    if (!isAuthorized(msg)) return;
    const newLimit = parseInt(match[1]);
    if (isNaN(newLimit) || newLimit < 1 || newLimit > 50) {
      bot.sendMessage(CHAT_ID, 'Valor invalido. Use um numero entre 1 e 50.');
      return;
    }
    process.env.MAX_DAILY_POSTS = String(newLimit);
    bot.sendMessage(CHAT_ID, 'Limite diario ajustado para ' + newLimit + ' posts.');
  });

  // /limite
  bot.onText(/\/limite$/, (msg) => {
    if (!isAuthorized(msg)) return;
    const todayCount = db.getTodayCount();
    bot.sendMessage(CHAT_ID, 'Posts hoje: ' + todayCount + '/' + MAX_DAILY_POSTS + '\n\nPara alterar: /limite [numero]');
  });

  // /post texto
  bot.onText(/\/post (.+)/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    const text = match[1].trim();
    if (text.length > 500) {
      bot.sendMessage(CHAT_ID, 'Post muito longo (' + text.length + ' chars). Maximo 500.');
      return;
    }
    try {
      const result = await postTweet(text);
      db.incrementTodayCount();
      bot.sendMessage(CHAT_ID, 'Postado!\n' + result.tweetUrl);
    } catch (err) {
      bot.sendMessage(CHAT_ID, 'Erro: ' + err.message);
    }
  });

  // /reply tweetId texto
  bot.onText(/\/reply (\d+) (.+)/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    const tweetId = match[1];
    const text = match[2].trim();
    try {
      const result = await postReply(text, tweetId);
      bot.sendMessage(CHAT_ID, 'Reply postado!\n' + result.tweetUrl);
    } catch (err) {
      bot.sendMessage(CHAT_ID, 'Erro: ' + err.message);
    }
  });

  // /limpar
  bot.onText(/\/limpar/, (msg) => {
    if (!isAuthorized(msg)) return;
    db.clearPendingQueue();
    bot.sendMessage(CHAT_ID, 'Fila limpa.');
  });

  // Mensagem livre
  bot.on('message', async (msg) => {
    if (!isAuthorized(msg)) return;
    if (msg.text && msg.text.startsWith('/')) return;
    const text = (msg.text || '').trim();
    if (!text || text.length < 5) return;

    // Estado: aguardando nome do produto após link sem nome
    const session = db.getSession(CHAT_ID);
    if (session && session.state === 'waiting_product_name') {
      const productName = text.trim();
      let pendingProduct;
      try { pendingProduct = JSON.parse(session.pending_product || '{}'); } catch { pendingProduct = {}; }
      pendingProduct.name = productName;
      db.setSession(CHAT_ID, { state: 'idle' });
      const priceInfo = pendingProduct.price
        ? 'R$' + pendingProduct.price.toFixed(2) + (pendingProduct.discountPct ? ' (-' + pendingProduct.discountPct + '%)' : '')
        : 'preço não encontrado';
      await presentActionChoice(pendingProduct, priceInfo);
      return;
    }

    // REPLY: tweetId contexto
    if (text.toUpperCase().startsWith('REPLY:')) {
      const parts = text.replace(/^REPLY:\s*/i, '').split(' ');
      const tweetId = parts[0];
      const context = parts.slice(1).join(' ');
      bot.sendMessage(CHAT_ID, 'Gerando reply...');
      try {
        const replyText = await generateReply(context || text, 'Reply para tweet ' + tweetId);
        db.setSession(CHAT_ID, { state: 'waiting_reply_approval', pendingPost: replyText, pendingProduct: { tweetId: tweetId } });
        await presentReplyForApproval(replyText, tweetId);
      } catch (err) {
        bot.sendMessage(CHAT_ID, 'Erro: ' + err.message);
      }
      return;
    }

    // URL — extrai produto e apresenta opções de geração
    if (isUrl(text)) {
      bot.sendMessage(CHAT_ID, 'Link detectado! Lendo produto...');
      try {
        const product = await extractProductFromUrl(text);

        // Se o nome for lixo (código, slug sem sentido), pede o nome manualmente
        if (isGarbageName(product.name)) {
          db.setSession(CHAT_ID, {
            state: 'waiting_product_name',
            pendingProduct: Object.assign({}, product, { name: '' }),
          });
          bot.sendMessage(CHAT_ID,
            'Não consegui ler o nome do produto automaticamente.\n\n' +
            'Me diga: qual é o produto? (ex: "Air Fryer Mondial 3.5L")'
          );
          return;
        }

        const priceInfo = product.price
          ? 'R$' + product.price.toFixed(2) + (product.discountPct ? ' (-' + product.discountPct + '%)' : '')
          : 'preço não encontrado';
        await presentActionChoice(product, priceInfo);
      } catch (err) {
        bot.sendMessage(CHAT_ID, 'Erro ao processar link: ' + err.message);
      }
      return;
    }

    // Texto livre — gera post/vídeo a partir dos dados
    try {
      const urlInText = extractUrlFromText(text);
      const fakeProduct = {
        name: text.replace(urlInText || '', '').substring(0, 100).trim(),
        price: null,
        originalPrice: null,
        discountPct: null,
        affiliateLink: urlInText || '',
        rating: null,
        salesCount: null,
        category: null,
      };
      await presentActionChoice(fakeProduct, 'preço não informado');
    } catch (err) {
      bot.sendMessage(CHAT_ID, 'Erro ao processar texto: ' + err.message);
    }
  });

  // Callbacks dos botoes
  bot.on('callback_query', async (query) => {
    const data = query.data;
    const parts = data.split('::');
    const action = parts[0];
    const id = parts[1];

    bot.answerCallbackQuery(query.id);

    if (action === 'post_approve') {
      // Tenta buscar do banco primeiro
      let item = db.getQueueItemById(id);

      // Se não encontrou no banco (Railway reiniciou), busca da sessão
      if (!item) {
        const session = db.getSession(CHAT_ID);
        if (session && session.pending_product) {
          try {
            const cached = JSON.parse(session.pending_product);
            if (cached && cached.id === id) {
              item = cached;
            }
          } catch (e) {}
        }
      }

      if (!item) { 
        bot.sendMessage(CHAT_ID, 'Item nao encontrado. Mande o link de novo para regenerar.');
        return; 
      }

      try {
        const { postWithReply } = require('./scheduler');
        const result = await postWithReply(item);
        if (item.id) db.markAsPosted(item.id, result.tweetId, result.tweetUrl);
        db.incrementTodayCount();
        bot.sendMessage(CHAT_ID, 'Postado!\n' + result.tweetUrl + '\n\nPosts hoje: ' + db.getTodayCount() + '/' + MAX_DAILY_POSTS);
      } catch (err) {
        bot.sendMessage(CHAT_ID, 'Erro ao postar: ' + err.message);
      }

    } else if (action === 'post_ignore') {
      db.markAsIgnored(id);
      bot.sendMessage(CHAT_ID, 'Post ignorado. Fila restante: ' + db.getPendingCount());

    } else if (action === 'post_regen') {
      const item = db.getQueueItemById(id);
      if (!item) { bot.sendMessage(CHAT_ID, 'Item nao encontrado.'); return; }
      bot.sendMessage(CHAT_ID, 'Regenerando post...');
      try {
        const product = {
          name: item.product_name,
          price: item.price,
          originalPrice: item.original_price,
          discountPct: item.discount_pct,
          affiliateLink: item.affiliate_link,
          rating: item.rating,
          salesCount: item.sales_count,
        };
        const newPosts = await generatePost(product);
        db.updateQueuePost(id, JSON.stringify(newPosts));
        const updated = db.getQueueItemById(id);
        await presentPostForApproval(updated);
      } catch (err) {
        bot.sendMessage(CHAT_ID, 'Erro: ' + err.message);
      }

    } else if (action === 'reply_approve') {
      const session = db.getSession(CHAT_ID);
      if (!session) return;
      const pendingPost = session.pending_post;
      const pendingProduct = JSON.parse(session.pending_product || '{}');
      try {
        const result = await postReply(pendingPost, pendingProduct.tweetId);
        db.setSession(CHAT_ID, { state: 'idle' });
        bot.sendMessage(CHAT_ID, 'Reply postado!\n' + result.tweetUrl);
      } catch (err) {
        bot.sendMessage(CHAT_ID, 'Erro: ' + err.message);
      }

    } else if (action === 'reply_ignore') {
      db.setSession(CHAT_ID, { state: 'idle' });
      bot.sendMessage(CHAT_ID, 'Reply ignorado.');

    } else if (action === 'action_choice') {
      const session = db.getSession(CHAT_ID);
      if (!session || !session.pending_product) {
        bot.sendMessage(CHAT_ID, 'Nenhum produto em cache na sessão.');
        return;
      }

      let product;
      try {
        product = typeof session.pending_product === 'string'
          ? JSON.parse(session.pending_product)
          : session.pending_product;
      } catch (e) {
        bot.sendMessage(CHAT_ID, 'Erro ao ler dados do produto da sessão.');
        return;
      }

      if (id === 'gen_x') {
        bot.sendMessage(CHAT_ID, 'Gerando post para o X...');
        db.setSession(CHAT_ID, { state: 'idle' });
        try {
          const posts = await generatePost(product);
          const queueId = db.addToQueue(Object.assign({}, product, { generatedPost: JSON.stringify(posts) }));
          const item = db.getQueueItemById(queueId);
          await presentPostForApproval(item);
        } catch (err) {
          bot.sendMessage(CHAT_ID, 'Erro ao gerar post para o X: ' + err.message);
        }
      } else if (id === 'gen_ugc') {
        db.setSession(CHAT_ID, { state: 'idle' });
        try {
          const { triggerUGCGeneration } = require('./ugcPipeline');
          await triggerUGCGeneration(product);
        } catch (err) {
          bot.sendMessage(CHAT_ID, 'Erro ao disparar UGC Pipeline: ' + err.message);
        }
      }

    } else if (action === 'ugc_approve') {
      bot.sendMessage(CHAT_ID, 'Aprovando e publicando vídeo UGC...');
      try {
        const { publishUGCVideo } = require('./ugcPipeline');
        await publishUGCVideo(id);
      } catch (err) {
        bot.sendMessage(CHAT_ID, 'Erro ao publicar UGC: ' + err.message);
      }

    } else if (action === 'ugc_ignore') {
      db.updateUgcVideo(id, { status: 'ignored' });
      bot.sendMessage(CHAT_ID, 'Vídeo UGC ignorado.');
    }
  });

  console.log('[Telegram] Bot iniciado e escutando.');
  return bot;
}

// Apresenta post para aprovacao
async function presentPostForApproval(item) {
  // Salva na sessão como backup caso o banco seja perdido
  db.setSession(CHAT_ID, { 
    state: 'pending_approval', 
    pendingProduct: item 
  });

  let posts;
  try {
    posts = JSON.parse(item.generated_post);
  } catch (e) {
    posts = { main: item.generated_post, reply: '' };
  }
  const price = item.price ? 'R$' + Number(item.price).toFixed(2) : 'sem preco';
  const text =
    '*' + (item.product_name || 'Produto').substring(0, 60) + '*\n' +
    price + ' (-' + item.discount_pct + '%)\n\n' +
    '*Post principal:*\n```\n' + (posts.main || '') + '\n```\n\n' +
    '*Reply (2min depois):*\n```\n' + (posts.reply || '') + '\n```';

  const keyboard = {
    inline_keyboard: [[
      { text: 'Postar no X', callback_data: 'post_approve::' + item.id },
      { text: 'Regenerar', callback_data: 'post_regen::' + item.id },
      { text: 'Ignorar', callback_data: 'post_ignore::' + item.id },
    ]],
  };
  bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// Apresenta reply para aprovacao
async function presentReplyForApproval(replyText, tweetId) {
  const text = '*Reply gerado:*\n```\n' + replyText + '\n```\nPara tweet: ' + tweetId;
  const keyboard = {
    inline_keyboard: [[
      { text: 'Postar reply', callback_data: 'reply_approve::' + tweetId },
      { text: 'Ignorar', callback_data: 'reply_ignore::' + tweetId },
    ]],
  };
  bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function presentActionChoice(product, priceInfo) {
  // Salva na sessão
  db.setSession(CHAT_ID, {
    state: 'waiting_action_choice',
    pendingProduct: product
  });

  const text = `📦 *Produto Detectado:*\n${product.name}\n${priceInfo}\n\nO que deseja gerar para este produto?`;
  const keyboard = {
    inline_keyboard: [[
      { text: '📝 Gerar Post para X', callback_data: 'action_choice::gen_x' },
      { text: '🎬 Gerar Vídeo UGC Gi', callback_data: 'action_choice::gen_ugc' }
    ]]
  };
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function presentUgcForApproval(ugcId) {
  const item = db.getUgcVideoById(ugcId);
  if (!item) return;

  const text = `🎬 *Vídeo UGC da Gi Gerado!*\n\n*Produto:* ${item.product_name}\n*Legenda sugerida:*\n\`\`\`\n${item.caption}\n\`\`\``;
  
  const keyboard = {
    inline_keyboard: [[
      { text: '🚀 Aprovar e Postar', callback_data: 'ugc_approve::' + item.id },
      { text: '❌ Ignorar', callback_data: 'ugc_ignore::' + item.id }
    ]]
  };

  const fs = require('fs');
  if (item.video_path && fs.existsSync(item.video_path)) {
    // Envia a mensagem descritiva primeiro
    await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
    // Envia o vídeo com botões de ação logo abaixo dele
    await bot.sendVideo(CHAT_ID, item.video_path, {
      caption: 'Assista ao vídeo final acima e escolha uma ação:',
      reply_markup: keyboard
    });
  } else {
    bot.sendMessage(CHAT_ID, text + '\n\n⚠️ Arquivo de vídeo não encontrado no disco.', {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

function isAuthorized(msg) {
  return String(msg.chat.id) === String(CHAT_ID);
}

function extractUrlFromText(text) {
  const match = text.match(/(https?:\/\/[^\s]+)/);
  return match ? match[0] : null;
}

function notifyTelegram(message) {
  if (!bot) return;
  bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
}

module.exports = { initTelegram, notifyTelegram, presentUgcForApproval };
