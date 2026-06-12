const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');

let accessToken = null;
let refreshToken = null;
let expiresAt = 0;
let client = null;

// Inicializa tokens das variáveis de ambiente
function initTwitter() {
  accessToken = process.env.TWITTER_OAUTH2_ACCESS_TOKEN;
  refreshToken = process.env.TWITTER_OAUTH2_REFRESH_TOKEN;
  expiresAt = Date.now() + (2 * 60 * 60 * 1000); // assume 2h a partir de agora
  client = new TwitterApi(accessToken);
  console.log('[Twitter] Cliente inicializado para @organizeepoupe');
}

// Renova o token via endpoint direto da API do X
async function doRefresh() {
  console.log('[Twitter] Renovando token...');

  if (!refreshToken) {
    throw new Error('Token expirado. Execute: node scripts/auth_twitter.js e atualize o Railway.');
  }

  try {
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: process.env.TWITTER_CLIENT_ID,
    });

    console.log('[Twitter] Client ID:', process.env.TWITTER_CLIENT_ID?.substring(0, 10) + '...');
    console.log('[Twitter] Refresh token:', refreshToken?.substring(0, 20) + '...');

    const res = await axios.post('https://api.x.com/2/oauth2/token', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.TWITTER_CLIENT_ID + ':' + process.env.TWITTER_CLIENT_SECRET
        ).toString('base64'),
      },
    });

    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token || refreshToken;
    expiresAt = Date.now() + (res.data.expires_in * 1000);
    client = new TwitterApi(accessToken);

    process.env.TWITTER_OAUTH2_ACCESS_TOKEN = accessToken;
    process.env.TWITTER_OAUTH2_REFRESH_TOKEN = refreshToken;

    console.log('[Twitter] Token renovado com sucesso. Expira em ' + Math.round(res.data.expires_in / 60) + ' minutos.');
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Twitter] Falha ao renovar. Detalhe:', detail);
    console.error('[Twitter] Client ID presente:', !!process.env.TWITTER_CLIENT_ID);
    console.error('[Twitter] Client Secret presente:', !!process.env.TWITTER_CLIENT_SECRET);
    console.error('[Twitter] Refresh token presente:', !!refreshToken);
    throw new Error('Token expirado. Execute: node scripts/auth_twitter.js e atualize o Railway.');
  }
}

// Garante cliente válido
async function getClient() {
  if (!accessToken) initTwitter();

  // Renova se faltar menos de 10 minutos
  if (Date.now() >= expiresAt - 10 * 60 * 1000) {
    await doRefresh();
  }

  return client;
}

// Posta tweet com retry no 401
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
      console.log('[Twitter] 401 recebido — renovando e tentando de novo...');
      await doRefresh();
      const c = await getClient();
      const tweet = await c.v2.tweet(text);
      const tweetId = tweet.data.id;
      return { tweetId, tweetUrl: 'https://x.com/organizeepoupe/status/' + tweetId };
    }
    throw err;
  }
}

// Posta reply com retry no 401
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
      console.log('[Twitter] 401 recebido — renovando e tentando de novo...');
      await doRefresh();
      const c = await getClient();
      const tweet = await c.v2.reply(text, replyToTweetId);
      const tweetId = tweet.data.id;
      return { tweetId, tweetUrl: 'https://x.com/organizeepoupe/status/' + tweetId };
    }
    throw err;
  }
}

module.exports = { postTweet, postReply, initTwitter };
