const { TwitterApi } = require('twitter-api-v2');

// =============================================
// OAuth 2.0 PKCE — tokens persistidos no banco
// =============================================

let client = null;
let tokenData = null;

function getDB() {
  return require('./db').getDB();
}

// Carrega tokens do banco sql.js (persiste entre restarts)
function loadTokens() {
  try {
    const db = getDB();
    const row = db.prepare
      ? db.prepare('SELECT value FROM kv_store WHERE key = ?').get('twitter_tokens')
      : null;

    // sql.js não tem prepare direto — usa exec
    const result = getDB().exec("SELECT value FROM kv_store WHERE key = 'twitter_tokens'");
    if (result.length > 0 && result[0].values.length > 0) {
      tokenData = JSON.parse(result[0].values[0][0]);
      console.log('[Twitter] Tokens carregados do banco. Expira em:', new Date(tokenData.expiresAt).toLocaleTimeString('pt-BR'));
      return true;
    }
  } catch (e) {
    // Tabela pode não existir ainda
  }

  // Fallback: variáveis de ambiente
  tokenData = {
    accessToken: process.env.TWITTER_OAUTH2_ACCESS_TOKEN,
    refreshToken: process.env.TWITTER_OAUTH2_REFRESH_TOKEN,
    expiresAt: 0, // Força refresh imediato
  };
  console.log('[Twitter] Tokens carregados das variáveis de ambiente.');
  return false;
}

// Salva tokens no banco sql.js
function saveTokens(accessToken, refreshToken, expiresIn) {
  tokenData = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (expiresIn * 1000),
  };

  try {
    // Cria tabela kv se não existir
    getDB().run(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)`);
    getDB().run(
      `INSERT OR REPLACE INTO kv_store (key, value) VALUES ('twitter_tokens', ?)`,
      [JSON.stringify(tokenData)]
    );
    // Persiste no arquivo via db.persist()
    require('./db').persist ? require('./db').persist() : null;
    console.log('[Twitter] Tokens salvos no banco. Expira em ' + Math.round(expiresIn / 60) + ' minutos.');
  } catch (e) {
    console.warn('[Twitter] Falha ao salvar tokens no banco:', e.message);
  }
}

// Renova o access token usando o refresh token
async function refreshAccessToken() {
  if (!tokenData?.refreshToken) {
    throw new Error('Refresh token ausente. Execute: node scripts/auth_twitter.js');
  }

  console.log('[Twitter] Renovando Access Token via refresh...');

  const refreshClient = new TwitterApi({
    clientId: process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET,
  });

  try {
    // Tenta via biblioteca primeiro
    const { accessToken, refreshToken: newRefreshToken, expiresIn } = await refreshClient.refreshOAuth2Token(tokenData.refreshToken);
    saveTokens(accessToken, newRefreshToken, expiresIn);
    client = new TwitterApi(accessToken);
    console.log('[Twitter] Token renovado com sucesso (biblioteca).');
  } catch (libErr) {
    console.warn('[Twitter] Biblioteca falhou, tentando endpoint direto...', libErr.message);
    // Fallback: endpoint direto conforme documentação OAuth 2.0 PKCE
    try {
      const axios = require('axios');
      const params = new URLSearchParams({
        refresh_token: tokenData.refreshToken,
        grant_type: 'refresh_token',
        client_id: process.env.TWITTER_CLIENT_ID,
      });
      const res = await axios.post('https://api.x.com/2/oauth2/token', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(
            process.env.TWITTER_CLIENT_ID + ':' + process.env.TWITTER_CLIENT_SECRET
          ).toString('base64'),
        },
      });
      const { access_token, refresh_token, expires_in } = res.data;
      saveTokens(access_token, refresh_token, expires_in);
      client = new TwitterApi(access_token);
      console.log('[Twitter] Token renovado com sucesso (endpoint direto).');
    } catch (directErr) {
      console.error('[Twitter] Ambos os métodos falharam:', directErr.message);
      throw new Error('Token expirado. Execute: node scripts/auth_twitter.js e atualize o Railway.');
    }
  }
}

// Retorna cliente válido — renova se necessário
async function getClient() {
  if (!tokenData) loadTokens();

  const fiveMinutes = 5 * 60 * 1000;
  const needsRefresh = !tokenData.expiresAt || Date.now() >= (tokenData.expiresAt - fiveMinutes);

  if (!client || needsRefresh) {
    await refreshAccessToken();
  }

  return client;
}

// Inicializa na startup
async function initTwitter() {
  loadTokens();
  try {
    await refreshAccessToken();
    console.log('[Twitter] Cliente OAuth 2.0 inicializado para @organizeepoupe');
  } catch (err) {
    console.error('[Twitter] ATENCAO:', err.message);
  }
}

// Posta tweet — com retry automático no 401
async function postTweet(text) {
  try {
    const c = await getClient();
    const tweet = await c.v2.tweet(text);
    const tweetId = tweet.data.id;
    const tweetUrl = 'https://x.com/organizeepoupe/status/' + tweetId;
    console.log('[Twitter] Postado: ' + tweetUrl);
    return { tweetId, tweetUrl };
  } catch (err) {
    if (err.message && err.message.includes('401')) {
      console.log('[Twitter] 401 — tentando refresh e retry...');
      await refreshAccessToken();
      const c = await getClient();
      const tweet = await c.v2.tweet(text);
      const tweetId = tweet.data.id;
      return { tweetId, tweetUrl: 'https://x.com/organizeepoupe/status/' + tweetId };
    }
    console.error('[Twitter] Erro ao postar:', err.message);
    throw err;
  }
}

// Posta reply — com retry automático no 401
async function postReply(text, replyToTweetId) {
  try {
    const c = await getClient();
    const tweet = await c.v2.reply(text, replyToTweetId);
    const tweetId = tweet.data.id;
    const tweetUrl = 'https://x.com/organizeepoupe/status/' + tweetId;
    console.log('[Twitter] Reply postado: ' + tweetUrl);
    return { tweetId, tweetUrl };
  } catch (err) {
    if (err.message && err.message.includes('401')) {
      console.log('[Twitter] 401 — tentando refresh e retry...');
      await refreshAccessToken();
      const c = await getClient();
      const tweet = await c.v2.reply(text, replyToTweetId);
      const tweetId = tweet.data.id;
      return { tweetId, tweetUrl: 'https://x.com/organizeepoupe/status/' + tweetId };
    }
    console.error('[Twitter] Erro ao postar reply:', err.message);
    throw err;
  }
}

module.exports = { postTweet, postReply, initTwitter };
