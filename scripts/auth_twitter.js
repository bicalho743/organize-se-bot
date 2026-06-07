/**
 * Script de autorização OAuth 2.0 para @OrganizeePoupe
 * 
 * Execute UMA VEZ localmente para gerar o Access Token:
 * 
 *   cd "C:\2 - PERSONAGENS\organize-se-bot"
 *   node scripts/auth_twitter.js
 * 
 * Cole o token gerado na variável TWITTER_OAUTH2_ACCESS_TOKEN no Railway.
 */

require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const http = require('http');
const url = require('url');

const CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
const CALLBACK_URL = 'http://localhost:3000/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Defina TWITTER_CLIENT_ID e TWITTER_CLIENT_SECRET no .env');
  console.error('   Esses valores ficam em: Developer Portal → App → Keys and tokens → OAuth 2.0 Client ID and Client Secret');
  process.exit(1);
}

const client = new TwitterApi({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

async function main() {
  // Gera URL de autorização
  const { url: authUrl, codeVerifier, state } = client.generateOAuth2AuthLink(
    CALLBACK_URL,
    { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
  );

  console.log('\n🔗 Abra este link no navegador LOGADO com a conta @OrganizeePoupe:\n');
  console.log(authUrl);
  console.log('\nAguardando autorização em http://localhost:3000/callback ...\n');

  // Sobe servidor local para capturar o callback
  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    if (!parsed.pathname.includes('/callback')) return;

    const { code, state: returnedState } = parsed.query;

    if (returnedState !== state) {
      res.end('❌ State inválido. Tente de novo.');
      server.close();
      return;
    }

    try {
      const { accessToken, refreshToken } = await client.loginWithOAuth2({
        code,
        codeVerifier,
        redirectUri: CALLBACK_URL,
      });

      res.end(`
        <h2>✅ Autorizado com sucesso!</h2>
        <p>Feche esta janela e volte ao terminal.</p>
      `);

      console.log('\n✅ Token gerado com sucesso!\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Adicione esta variável no Railway (Settings > Variables):');
      console.log('');
      console.log(`TWITTER_OAUTH2_ACCESS_TOKEN=${accessToken}`);
      if (refreshToken) {
        console.log(`TWITTER_OAUTH2_REFRESH_TOKEN=${refreshToken}`);
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    } catch (err) {
      res.end(`❌ Erro: ${err.message}`);
      console.error('❌ Erro ao obter token:', err.message);
    }

    server.close();
  });

  server.listen(3000);
}

main().catch(console.error);
