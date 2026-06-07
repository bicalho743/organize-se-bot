const { TwitterApi } = require('twitter-api-v2');

let client;

function getClient() {
  if (!client) {
    // OAuth 2.0 com Access Token da conta @OrganizeSeBR
    // O token é gerado pelo script scripts/auth_twitter.js
    client = new TwitterApi(process.env.TWITTER_OAUTH2_ACCESS_TOKEN);
  }
  return client.readWrite;
}

async function postTweet(text) {
  try {
    const tweet = await getClient().v2.tweet(text);
    const tweetId = tweet.data.id;
    const tweetUrl = `https://x.com/OrganizeePoupe/status/${tweetId}`;
    console.log(`[Twitter] Postado com sucesso: ${tweetUrl}`);
    return { tweetId, tweetUrl };
  } catch (err) {
    console.error('[Twitter] Erro ao postar tweet:', err.message);
    throw err;
  }
}

async function postReply(text, replyToTweetId) {
  try {
    const tweet = await getClient().v2.reply(text, replyToTweetId);
    const tweetId = tweet.data.id;
    const tweetUrl = `https://x.com/OrganizeePoupe/status/${tweetId}`;
    console.log(`[Twitter] Reply postado: ${tweetUrl}`);
    return { tweetId, tweetUrl };
  } catch (err) {
    console.error('[Twitter] Erro ao postar reply:', err.message);
    throw err;
  }
}

module.exports = { postTweet, postReply };
