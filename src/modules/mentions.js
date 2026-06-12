const { TwitterApi } = require('twitter-api-v2');
const { generateReply } = require('./openai');
const { postReply } = require('./twitter');
const { notifyTelegram } = require('./telegram');

// ID da conta @organizeepoupe — buscamos via API na inicialização
let ACCOUNT_ID = null;
let lastMentionId = null;

async function getAccountId() {
  if (ACCOUNT_ID) return ACCOUNT_ID;
  try {
    const client = new TwitterApi(process.env.TWITTER_OAUTH2_ACCESS_TOKEN);
    const me = await client.v2.me();
    ACCOUNT_ID = me.data.id;
    console.log('[Mentions] Account ID:', ACCOUNT_ID);
    return ACCOUNT_ID;
  } catch (err) {
    console.error('[Mentions] Erro ao buscar account ID:', err.message);
    return null;
  }
}

async function checkMentions() {
  try {
    const accountId = await getAccountId();
    if (!accountId) return;

    const client = new TwitterApi(process.env.TWITTER_OAUTH2_ACCESS_TOKEN);

    const params = {
      max_results: 10,
      'tweet.fields': ['author_id', 'text', 'created_at', 'in_reply_to_user_id'],
      expansions: ['author_id'],
      'user.fields': ['username'],
    };

    // Só busca menções mais novas que a última processada
    if (lastMentionId) {
      params.since_id = lastMentionId;
    }

    const mentions = await client.v2.userMentionTimeline(accountId, params);

    if (!mentions.data?.data || mentions.data.data.length === 0) {
      return;
    }

    // Atualiza o ID da última menção processada
    lastMentionId = mentions.data.data[0].id;

    const users = mentions.data.includes?.users || [];

    console.log(`[Mentions] ${mentions.data.data.length} nova(s) menção(ões) encontrada(s).`);

    // Processa cada menção — ignora as do próprio bot
    for (const mention of mentions.data.data) {
      if (mention.author_id === accountId) continue;

      // Encontra o username do autor
      const author = users.find(u => u.id === mention.author_id);
      const username = author?.username || 'alguem';

      console.log(`[Mentions] Respondendo @${username}: ${mention.text.substring(0, 60)}...`);

      try {
        // Gera reply com a personalidade da Gi
        const context = `@${username} comentou no seu post: "${mention.text}"`;
        const replyText = await generateReply(mention.text, context);

        // Posta o reply
        await postReply(replyText, mention.id);

        console.log(`[Mentions] Reply postado para @${username}.`);
        notifyTelegram(`💬 *Reply automático*\n@${username}: ${mention.text.substring(0, 80)}\n\nGi: ${replyText}`);

        // Pequena pausa entre replies para não sobrecarregar a API
        await new Promise(resolve => setTimeout(resolve, 3000));

      } catch (err) {
        console.error(`[Mentions] Erro ao responder @${username}:`, err.message);
      }
    }

  } catch (err) {
    console.error('[Mentions] Erro ao buscar menções:', err.message);
  }
}

// Inicializa o monitoramento — verifica a cada 5 minutos
function initMentions() {
  // Busca o ID da conta na inicialização
  getAccountId().then(id => {
    if (!id) {
      console.warn('[Mentions] Não foi possível inicializar monitoramento de menções.');
      return;
    }

    // Define o lastMentionId para não responder menções antigas
    const client = new TwitterApi(process.env.TWITTER_OAUTH2_ACCESS_TOKEN);
    client.v2.userMentionTimeline(id, { max_results: 1 })
      .then(res => {
        if (res.data?.data?.[0]) {
          lastMentionId = res.data.data[0].id;
          console.log('[Mentions] Última menção conhecida:', lastMentionId);
        }
      })
      .catch(() => {});

    // Verifica menções a cada 5 minutos
    setInterval(checkMentions, 5 * 60 * 1000);
    console.log('[Mentions] Monitoramento automático iniciado (a cada 5min).');
  });
}

module.exports = { initMentions, checkMentions };
