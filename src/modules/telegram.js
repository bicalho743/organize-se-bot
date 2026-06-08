const TelegramBot = require('node-telegram-bot-api');
const { generatePost, generateReply } = require('./openai');
const { isUrl, extractProductFromUrl } = require('./linkReader');
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

  // =============================================
  // COMANDOS
  // =============================================

  bot.onText(/\/start/, (msg) => {
    if (!isAuthorized(msg)) return;
    bot.sendMessage(CHAT_ID, `🤖 *Organize-se Bot online*

Comandos disponíveis:
/status — situação do bot
/fila — ver fila de posts pendentes
/buscar — buscar promoções da Shopee agora
/postar — postar próximo da fila no X
/limite — ver/alterar posts diários
/post [texto] — post manual no X
/reply [tweet_id] [texto] — reply em tweet
/limpar — limpar fila pendente

Ou me mande qualquer texto com dados de promoção que eu gero o post.`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/status/, (msg) => {
    if (!isAuthorized(msg)) return;
    const pending = db.getPendingCount();
    const todayCount = db.getTodayCount();
    const recentPosts = db.getRecentPosts(3);

    let text = `📊 *Status do Bot*\n\n`;
    text += `Posts hoje: ${todayCount}/${MAX_DAILY_POSTS}\n`;
    text += `Na fila: ${pending} produto(s)\n\n`;

    if (recentPosts.length > 0) {
      text += `*Últimos posts:*\n`;
      recentPosts.forEach(p => {
        const time = new Date(p.posted_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        text += `• [${time}] ${p.product_name?.substring(0, 40)}...\n`;
      });
    }

    bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/fila/, (msg) => {
    if (!isAuthorized(msg)) return;
    const queue = db.getQueueList();

    if (queue.length === 0) {
      bot.sendMessage(CHAT_ID, '📭 Fila vazia. Use /buscar para trazer promoções.');
      return;
    }

    let text = `📋 *Fila de posts (${queue.length})*\n\n`;
    queue.forEach((item, i) => {
      text += `${i + 1}. ${item.product_name?.substring(0, 50)}\n`;
      text += `   R$${item.price?.toFixed(2)} (-${item.discount_pct}%)\n`;
    });

    bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/buscar/, async (msg) => {
    if (!isAuthorized(msg)) return;
    bot.sendMessage(CHAT_ID, '🔍 Buscando promoções na Shopee...');

    try {
      const deals = await fetchBestDeals(8);

      if (deals.length === 0) {
        bot.sendMessage(CHAT_ID, '😕 Nenhuma promoção qualificada encontrada. Tente de novo em instantes.');
        return;
      }

      let added = 0;
      for (const product of deals) {
        if (db.wasPostedRecently(product.name)) {
          console.log(`[Telegram] Pulando produto já postado: ${product.name}`);
          continue;
        }

        const generatedPost = await generatePost(product);
        db.addToQueue({ ...product, generatedPost });
        added++;
      }

      bot.sendMessage(CHAT_ID, `✅ ${added} produtos adicionados à fila.\nUse /fila para ver ou /postar para publicar agora.`);
    } catch (err) {
      console.error('[Telegram] Erro no /buscar:', err);
      bot.sendMessage(CHAT_ID, `❌ Erro ao buscar: ${err.message}`);
    }
  });

  bot.onText(/\/postar/, async (msg) => {
    if (!isAuthorized(msg)) return;

    const todayCount = db.getTodayCount();
    if (todayCount >= MAX_DAILY_POSTS) {
      bot.sendMessage(CHAT_ID, `⛔ Limite diário atingido (${todayCount}/${MAX_DAILY_POSTS}).\nAjuste com /limite.`);
      return;
    }

    const next = db.getNextInQueue();
    if (!next) {
      bot.sendMessage(CHAT_ID, '📭 Fila vazia. Use /buscar para trazer promoções.');
      return;
    }

    await presentPostForApproval(next);
  });

  bot.onText(/\/limite (.+)/, (msg, match) => {
    if (!isAuthorized(msg)) return;
    const newLimit = parseInt(match[1]);
    if (isNaN(newLimit) || newLimit < 1 || newLimit > 50) {
      bot.sendMessage(CHAT_ID, '⚠️ Valor inválido. Use um número entre 1 e 50.');
      return;
    }
    process.env.MAX_DAILY_POSTS = String(newLimit);
    bot.sendMessage(CHAT_ID, `✅ Limite diário ajustado para ${newLimit} posts.`);
  });

  bot.onText(/\/limite$/, (msg) => {
    if (!isAuthorized(msg)) return;
    const todayCount = db.getTodayCount();
    bot.sendMessage(CHAT_ID, `📊 Posts hoje: ${todayCount}/${MAX_DAILY_POSTS}\n\nPara alterar: /limite [número]`);
  });

  // Post manual
  bot.onText(/\/post (.+)/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    const text = match[1].trim();
    if (text.length > 500) {
      bot.sendMessage(CHAT_ID, `⚠️ Post muito longo (${text.length} chars). Máximo 500.`);
      return;
    }

    try {
      const { tweetUrl } = await postTweet(text);
      db.incrementTodayCount();
      bot.sendMessage(CHAT_ID, `✅ Postado!\n${tweetUrl}`);
    } catch (err) {
      bot.sendMessage(CHAT_ID, `❌ Erro: ${err.message}`);
    }
  });

  // Reply manual
  bot.onText(/\/reply (\d+) (.+)/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    const tweetId = match[1];
    const text = match[2].trim();

    try {
      const { tweetUrl } = await postReply(text, tweetId);
      bot.sendMessage(CHAT_ID, `✅ Reply postado!\n${tweetUrl}`);
    } catch (err) {
      bot.sendMessage(CHAT_ID, `❌ Erro: ${err.message}`);
    }
  });

  bot.onText(/\/limpar/, (msg) => {
    if (!isAuthorized(msg)) return;
    
    db.clearPendingQueue();
    bot.sendMessage(CHAT_ID, '🗑️ Fila limpa.');
  });

  // =============================================
  // MENSAGEM LIVRE — gera post de texto bruto
  // =============================================
  bot.on('message', async (msg) => {
    if (!isAuthorized(msg)) return;
    if (msg.text?.startsWith('/')) return;

    const text = msg.text?.trim();
    if (!text || text.length < 10) return;

    // Verifica se é REPLY: [id] formato
    if (text.toUpperCase().startsWith('REPLY:')) {
      const parts = text.replace(/^REPLY:\s*/i, '').split(' ');
      const tweetId = parts[0];
      const context = parts.slice(1).join(' ');

      bot.sendMessage(CHAT_ID, '💬 Gerando reply...');
      try {
        const replyText = await generateReply(context || text, `Reply para tweet ${tweetId}`);
        db.setSession(CHAT_ID, { state: 'waiting_reply_approval', pendingPost: replyText, pendingProduct: { tweetId } });
        await presentReplyForApproval(replyText, tweetId);
      } catch (err) {
        bot.sendMessage(CHAT_ID, `❌ Erro: ${err.message}`);
      }
      return;
    }

    // Detecta se é uma URL — extrai produto automaticamente
    if (isUrl(text)) {
      bot.sendMessage(CHAT_ID, '🔗 Link detectado! Lendo produto...');
      try {
        const product = await extractProductFromUrl(text);
        bot.sendMessage(CHAT_ID,
          `📦 *${product.name?.substring(0, 80)}*\n` +
          `💰 ${product.price ? 'R
  });

  // =============================================
  // CALLBACKS DOS BOTÕES
  // =============================================
  bot.on('callback_query', async (query) => {
    const data = query.data;
    const [action, id] = data.split('::');

    bot.answerCallbackQuery(query.id);

    if (action === 'post_approve') {
      const item = db.getQueueItemById(id);
      if (!item) { bot.sendMessage(CHAT_ID, '❌ Item não encontrado.'); return; }

      try {
        const { postWithReply } = require('./scheduler');
        const { tweetId, tweetUrl } = await postWithReply(item);
        db.markAsPosted(id, tweetId, tweetUrl);
        db.incrementTodayCount();
        bot.sendMessage(CHAT_ID, `✅ Postado!\n${tweetUrl}\n\nPosts hoje: ${db.getTodayCount()}/${MAX_DAILY_POSTS}`);
      } catch (err) {
        bot.sendMessage(CHAT_ID, `❌ Erro ao postar: ${err.message}`);
      }

    } else if (action === 'post_ignore') {
      db.markAsIgnored(id);
      bot.sendMessage(CHAT_ID, `🗑️ Post ignorado.\nFila restante: ${db.getPendingCount()} item(s).`);

    } else if (action === 'post_regen') {
      const item = db.getQueueItemById(id);
      if (!item) { bot.sendMessage(CHAT_ID, '❌ Item não encontrado.'); return; }

      bot.sendMessage(CHAT_ID, '🔄 Regenerando post...');
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
        bot.sendMessage(CHAT_ID, `❌ Erro: ${err.message}`);
      }

    } else if (action === 'reply_approve') {
      const session = db.getSession(CHAT_ID);
      if (!session) return;
      const { pendingPost, pendingProduct } = session;
      const product = JSON.parse(pendingProduct || '{}');

      try {
        const { tweetUrl } = await postReply(pendingPost, product.tweetId);
        db.setSession(CHAT_ID, { state: 'idle' });
        bot.sendMessage(CHAT_ID, `✅ Reply postado!\n${tweetUrl}`);
      } catch (err) {
        bot.sendMessage(CHAT_ID, `❌ Erro: ${err.message}`);
      }

    } else if (action === 'reply_ignore') {
      db.setSession(CHAT_ID, { state: 'idle' });
      bot.sendMessage(CHAT_ID, '🗑️ Reply ignorado.');
    }
  });

  console.log('[Telegram] Bot iniciado e escutando.');
  return bot;
}

// =============================================
// HELPERS
// =============================================

async function presentPostForApproval(item) {
  let posts;
  try { posts = JSON.parse(item.generated_post); } catch { posts = { main: item.generated_post, reply: '' }; }
  const text = `📦 *${item.product_name?.substring(0, 60)}*\n` +
    `💰 R${item.price?.toFixed(2)} (-${item.discount_pct}%)\n\n` +
    `🐦 *Post principal:*\n\`\`\`\n${posts.main}\n\`\`\`\n\n` +
    `💬 *Reply (2min depois):*\n\`\`\`\n${posts.reply}\n\`\`\``;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Postar no X', callback_data: `post_approve::${item.id}` },
      { text: '🔄 Regenerar', callback_data: `post_regen::${item.id}` },
      { text: '🗑️ Ignorar', callback_data: `post_ignore::${item.id}` },
    ]],
  };

  bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function presentReplyForApproval(replyText, tweetId) {
  const text = `💬 *Reply gerado:*\n\`\`\`\n${replyText}\n\`\`\`\nPara tweet: ${tweetId}`;
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Postar reply', callback_data: `reply_approve::${tweetId}` },
      { text: '🗑️ Ignorar', callback_data: `reply_ignore::${tweetId}` },
    ]],
  };
  bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

function isAuthorized(msg) {
  return String(msg.chat.id) === String(CHAT_ID);
}

function extractUrlFromText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

function notifyTelegram(message) {
  if (!bot) return;
  bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
}

module.exports = { initTelegram, notifyTelegram };
 + product.price.toFixed(2) : 'preço não encontrado'}` +
          `${product.discountPct ? ' (-' + product.discountPct + '%)' : ''}\n\n⚙️ Gerando posts...`,
          { parse_mode: 'Markdown' }
        );
        const posts = await generatePost(product);
        const id = db.addToQueue({ ...product, generatedPost: JSON.stringify(posts) });
        const item = db.getQueueItemById(id);
        await presentPostForApproval(item);
      } catch (err) {
        bot.sendMessage(CHAT_ID, `❌ Erro ao processar link: ${err.message}`);
      }
      return;
    }

    // Trata como dados brutos de promoção (texto livre)
    bot.sendMessage(CHAT_ID, '⚙️ Gerando post a partir do texto...');
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
      const posts = await generatePost(fakeProduct);
      const id = db.addToQueue({ ...fakeProduct, generatedPost: JSON.stringify(posts) });
      const item = db.getQueueItemById(id);
      await presentPostForApproval(item);
    } catch (err) {
      bot.sendMessage(CHAT_ID, `❌ Erro ao gerar post: ${err.message}`);
    }
  });

  // =============================================
  // CALLBACKS DOS BOTÕES
  // =============================================
  bot.on('callback_query', async (query) => {
    const data = query.data;
    const [action, id] = data.split('::');

    bot.answerCallbackQuery(query.id);

    if (action === 'post_approve') {
      const item = db.getQueueItemById(id);
      if (!item) { bot.sendMessage(CHAT_ID, '❌ Item não encontrado.'); return; }

      try {
        const { postWithReply } = require('./scheduler');
        const { tweetId, tweetUrl } = await postWithReply(item);
        db.markAsPosted(id, tweetId, tweetUrl);
        db.incrementTodayCount();
        bot.sendMessage(CHAT_ID, `✅ Postado!\n${tweetUrl}\n\nPosts hoje: ${db.getTodayCount()}/${MAX_DAILY_POSTS}`);
      } catch (err) {
        bot.sendMessage(CHAT_ID, `❌ Erro ao postar: ${err.message}`);
      }

    } else if (action === 'post_ignore') {
      db.markAsIgnored(id);
      bot.sendMessage(CHAT_ID, `🗑️ Post ignorado.\nFila restante: ${db.getPendingCount()} item(s).`);

    } else if (action === 'post_regen') {
      const item = db.getQueueItemById(id);
      if (!item) { bot.sendMessage(CHAT_ID, '❌ Item não encontrado.'); return; }

      bot.sendMessage(CHAT_ID, '🔄 Regenerando post...');
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
        bot.sendMessage(CHAT_ID, `❌ Erro: ${err.message}`);
      }

    } else if (action === 'reply_approve') {
      const session = db.getSession(CHAT_ID);
      if (!session) return;
      const { pendingPost, pendingProduct } = session;
      const product = JSON.parse(pendingProduct || '{}');

      try {
        const { tweetUrl } = await postReply(pendingPost, product.tweetId);
        db.setSession(CHAT_ID, { state: 'idle' });
        bot.sendMessage(CHAT_ID, `✅ Reply postado!\n${tweetUrl}`);
      } catch (err) {
        bot.sendMessage(CHAT_ID, `❌ Erro: ${err.message}`);
      }

    } else if (action === 'reply_ignore') {
      db.setSession(CHAT_ID, { state: 'idle' });
      bot.sendMessage(CHAT_ID, '🗑️ Reply ignorado.');
    }
  });

  console.log('[Telegram] Bot iniciado e escutando.');
  return bot;
}

// =============================================
// HELPERS
// =============================================

async function presentPostForApproval(item) {
  let posts;
  try { posts = JSON.parse(item.generated_post); } catch { posts = { main: item.generated_post, reply: '' }; }
  const text = `📦 *${item.product_name?.substring(0, 60)}*\n` +
    `💰 R${item.price?.toFixed(2)} (-${item.discount_pct}%)\n\n` +
    `🐦 *Post principal:*\n\`\`\`\n${posts.main}\n\`\`\`\n\n` +
    `💬 *Reply (2min depois):*\n\`\`\`\n${posts.reply}\n\`\`\``;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Postar no X', callback_data: `post_approve::${item.id}` },
      { text: '🔄 Regenerar', callback_data: `post_regen::${item.id}` },
      { text: '🗑️ Ignorar', callback_data: `post_ignore::${item.id}` },
    ]],
  };

  bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function presentReplyForApproval(replyText, tweetId) {
  const text = `💬 *Reply gerado:*\n\`\`\`\n${replyText}\n\`\`\`\nPara tweet: ${tweetId}`;
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Postar reply', callback_data: `reply_approve::${tweetId}` },
      { text: '🗑️ Ignorar', callback_data: `reply_ignore::${tweetId}` },
    ]],
  };
  bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

function isAuthorized(msg) {
  return String(msg.chat.id) === String(CHAT_ID);
}

function extractUrlFromText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

function notifyTelegram(message) {
  if (!bot) return;
  bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
}

module.exports = { initTelegram, notifyTelegram };
