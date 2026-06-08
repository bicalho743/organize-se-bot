const { TwitterApi } = require('twitter-api-v2');

let client;
let tokenExpiresAt = 0;

async function getClient() {
  const now = Date.now();

  // Renova se faltar menos de 5 minutos para expirar
  if (!client || now >= tokenExpiresAt - 5 * 60 * 1000) {
    await refreshToken();
  }

  return client;
}

async function refreshToken() {
  try {
    console.log('[Twitter] Renovando Access Token OAuth 2.0...');

    const refreshClient = new TwitterApi({
      clientId: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
    });

    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    } = await refreshClient.refreshOAuth2Token(process.env.TWITTER_OAUTH2_REFRESH_TOKEN);

    // Atualiza o refresh token em memória
    process.env.TWITTER_OAUTH2_REFRESH_TOKEN = newRefreshToken;
    process.env.TWITTER_OAUTH2_ACCESS_TOKEN = accessToken;

    // Marca quando expira (em ms)
    tokenExpiresAt = Date.now() + (expiresIn * 1000);

    client = new TwitterApi(accessToken);

    console.log(`[Twitter] Token renovado. Expira em ${Math.round(expiresIn / 60)} minutos.`);
  } catch (err) {
    console.error('[Twitter] Erro ao renovar token:', err.message);
    // Tenta usar o token atual mesmo assim
    client = new TwitterApi(process.env.TWITTER_OAUTH2_ACCESS_TOKEN);
    tokenExpiresAt = Date.now() + 60 * 60 * 1000; // tenta por 1h
  }
}

async function postTweet(text) {
  try {
    const c = await getClient();
    const tweet = await c.v2.tweet(text);
    const tweetId = tweet.data.id;
    const tweetUrl = `https://x.com/organizeepoupe/status/${tweetId}`;
    console.log(`[Twitter] Postado com sucesso: ${tweetUrl}`);
    return { tweetId, tweetUrl };
  } catch (err) {
    console.error('[Twitter] Erro ao postar tweet:', err.message);
    throw err;
  }
}

async function postReply(text, replyToTweetId) {
  try {
    const c = await getClient();
    const tweet = await c.v2.reply(text, replyToTweetId);
    const tweetId = tweet.data.id;
    const tweetUrl = `https://x.com/organizeepoupe/status/${tweetId}`;
    console.log(`[Twitter] Reply postado: ${tweetUrl}`);
    return { tweetId, tweetUrl };
  } catch (err) {
    console.error('[Twitter] Erro ao postar reply:', err.message);
    throw err;
  }
}

// Inicializa o token na primeira carga
async function initTwitter() {
  await refreshToken();
  console.log('[Twitter] Cliente OAuth 2.0 inicializado para @organizeepoupe');
}

module.exports = { postTweet, postReply, initTwitter };
