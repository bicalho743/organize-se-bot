const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

const TOKENS_PATH = path.join(__dirname, '..', '..', 'data', 'twitter_tokens.json');

function loadTokens() {
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    } catch (e) {
      console.error('[Twitter] Erro ao carregar arquivo de tokens, usando .env:', e.message);
    }
  }
  return {
    accessToken: process.env.TWITTER_OAUTH2_ACCESS_TOKEN,
    refreshToken: process.env.TWITTER_OAUTH2_REFRESH_TOKEN,
    expiresAt: 0,
  };
}

function saveTokens(tokens) {
  try {
    const dir = path.dirname(TOKENS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error('[Twitter] Falha ao persistir tokens em arquivo:', e.message);
  }
}

function initTwitter() {
  console.log('[Twitter] Cliente inicializado com suporte a persistência local de tokens.');
}

async function getClient() {
  let tokens = loadTokens();
  const oauthClient = new TwitterApi({
    clientId: process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET,
  });

  const needsRefresh = !tokens.accessToken || Date.now() > (tokens.expiresAt - 5 * 60 * 1000);
  if (needsRefresh) {
    if (!tokens.refreshToken) {
      throw new Error('[twitter] sem refresh token — rode scripts/auth_twitter.js');
    }
    try {
      const refreshed = await oauthClient.refreshOAuth2Token(tokens.refreshToken);
      tokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || tokens.refreshToken,
        expiresAt: Date.now() + (refreshed.expiresIn * 1000),
      };
      saveTokens(tokens);
      console.log('[Twitter] Token OAuth2 renovado com sucesso.');
    } catch (err) {
      throw new Error(`[twitter] falha ao renovar token: ${err.message}`);
    }
  }
  return new TwitterApi(tokens.accessToken);
}

async function getMe() {
  const client = await getClient();
  const me = await client.v2.me();
  return me.data;
}

async function postTweet(text) {
  const client = await getClient();
  const res = await client.v2.tweet({ text });
  const tweetId = res.data.id;
  const tweetUrl = 'https://x.com/status/' + tweetId;
  return { tweetId, tweetUrl };
}

async function postReply(text, replyToTweetId) {
  const client = await getClient();
  const res = await client.v2.tweet({
    text,
    reply: { in_reply_to_tweet_id: replyToTweetId }
  });
  const tweetId = res.data.id;
  const tweetUrl = 'https://x.com/status/' + tweetId;
  return { tweetId, tweetUrl };
}

module.exports = { initTwitter, getClient, getMe, postTweet, postReply };
