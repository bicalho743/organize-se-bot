const { TwitterApi } = require('twitter-api-v2');

let client;

function getClient() {
  if (!client) {
    client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });
  }
  return client.readWrite;
}

async function postTweet(text) {
  try {
    const tweet = await getClient().v2.tweet(text);
    const tweetId = tweet.data.id;
    const tweetUrl = `https://x.com/OrganizeSeBR/status/${tweetId}`;
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
    const tweetUrl = `https://x.com/OrganizeSeBR/status/${tweetId}`;
    console.log(`[Twitter] Reply postado: ${tweetUrl}`);
    return { tweetId, tweetUrl };
  } catch (err) {
    console.error('[Twitter] Erro ao postar reply:', err.message);
    throw err;
  }
}

module.exports = { postTweet, postReply };
