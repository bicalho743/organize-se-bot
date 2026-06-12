const cron = require('node-cron');
const { fetchBestDeals } = require('./shopee');
const { generatePost } = require('./openai');
const { postTweet, postReply } = require('./twitter');
const db = require('./db');
const { notifyTelegram } = require('./telegram');

const TZ = 'America/Sao_Paulo';

const POST_SCHEDULES = [
  '0 8 * * *',
  '0 12 * * *',
  '0 17 * * *',
  '0 20 * * *',
  '0 22 * * *',
];

const FETCH_SCHEDULES = [
  '0 7 * * *',
  '30 11 * * *',
  '0 16 * * *',
];

// Posta curiosidade + reply de promoção com 2min de intervalo
// O reply roda em background para não bloquear a resposta ao usuário
async function postWithReply(item) {
  let posts;
  try {
    posts = JSON.parse(item.generated_post);
  } catch {
    posts = { main: item.generated_post, reply: null };
  }

  // Posta o post principal
  const { tweetId, tweetUrl } = await postTweet(posts.main);
  console.log(`[Scheduler] Post principal: ${tweetUrl}`);

  // Reply roda em background — não bloqueia retorno ao usuário
  if (posts.reply) {
    setTimeout(async () => {
      try {
        await postReply(posts.reply, tweetId);
        console.log(`[Scheduler] Reply com promoção postado.`);
        notifyTelegram(`💬 Reply postado em @organizeepoupe`);
      } catch (err) {
        console.error('[Scheduler] Erro no reply:', err.message);
        notifyTelegram(`❌ Erro no reply: ${err.message}`);
      }
    }, 2 * 60 * 1000); // 2 minutos
    console.log('[Scheduler] Reply agendado para 2 minutos.');
  }

  return { tweetId, tweetUrl };
}

async function autoPost() {
  const MAX_DAILY = parseInt(process.env.MAX_DAILY_POSTS || '5');
  const todayCount = db.getTodayCount();

  if (todayCount >= MAX_DAILY) {
    console.log(`[Scheduler] Limite diário atingido (${todayCount}/${MAX_DAILY}). Pulando.`);
    return;
  }

  const next = db.getNextInQueue();
  if (!next) {
    console.log('[Scheduler] Fila vazia. Aguardando próxima busca automática.');
    return;
  }

  try {
    const { tweetId, tweetUrl } = await postWithReply(next);
    db.markAsPosted(next.id, tweetId, tweetUrl);
    db.incrementTodayCount();

    const newCount = db.getTodayCount();
    notifyTelegram(`📤 *Post automático enviado*\n${tweetUrl}\n📊 ${newCount}/${MAX_DAILY} hoje`);
  } catch (err) {
    console.error('[Scheduler] Erro no post automático:', err.message);
    notifyTelegram(`❌ Erro no post automático: ${err.message}`);
  }
}

async function autoFetch() {
  const shopeeOk = ['SHOPEE_APP_ID', 'SHOPEE_SECRET_KEY', 'SHOPEE_ACCESS_TOKEN'].every(k => process.env[k]);
  if (!shopeeOk) {
    console.log('[Scheduler] Shopee não configurada, pulando busca.');
    return;
  }

  console.log('[Scheduler] Buscando novas promoções Shopee...');

  try {
    const deals = await fetchBestDeals(10);
    let added = 0;

    for (const product of deals) {
      if (db.wasPostedRecently(product.name, 48)) continue;
      const posts = await generatePost(product);
      db.addToQueue({ ...product, generatedPost: JSON.stringify(posts) });
      added++;
    }

    console.log(`[Scheduler] ${added} produtos adicionados à fila.`);
    if (added > 0) {
      notifyTelegram(`🛍️ *Busca automática*\n${added} promoção(ões) na fila.\nTotal: ${db.getPendingCount()}`);
    }
  } catch (err) {
    console.error('[Scheduler] Erro na busca automática:', err.message);
  }
}

function initScheduler() {
  POST_SCHEDULES.forEach(schedule => cron.schedule(schedule, autoPost, { timezone: TZ }));
  FETCH_SCHEDULES.forEach(schedule => cron.schedule(schedule, autoFetch, { timezone: TZ }));

  console.log('[Scheduler] Cron jobs iniciados:');
  console.log('  Posts automáticos: 08h, 12h, 17h, 20h, 22h');
  console.log('  Busca Shopee: 07h, 11h30, 16h');
}

module.exports = { initScheduler, autoPost, autoFetch, postWithReply };
