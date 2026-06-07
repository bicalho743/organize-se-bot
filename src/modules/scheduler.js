const cron = require('node-cron');
const { fetchBestDeals } = require('./shopee');
const { generatePost } = require('./openai');
const { postTweet } = require('./twitter');
const db = require('./db');
const { notifyTelegram } = require('./telegram');

const TZ = 'America/Sao_Paulo';

// Horários de postagem automática (Brasília)
const POST_SCHEDULES = [
  '0 8 * * *',   // 08:00
  '0 12 * * *',  // 12:00
  '0 17 * * *',  // 17:00
  '0 20 * * *',  // 20:00
  '0 22 * * *',  // 22:00
];

// Busca promos da Shopee 3x por dia e abastece a fila
const FETCH_SCHEDULES = [
  '0 7 * * *',   // 07:00 — abastece para o dia
  '30 11 * * *', // 11:30 — reabastece pro meio-dia
  '0 16 * * *',  // 16:00 — reabastece pra tarde/noite
];

async function autoPost() {
  const MAX_DAILY = parseInt(process.env.MAX_DAILY_POSTS || '6');
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
    console.log(`[Scheduler] Postando automaticamente: ${next.product_name}`);
    const { tweetId, tweetUrl } = await postTweet(next.generated_post);
    db.markAsPosted(next.id, tweetId, tweetUrl);
    db.incrementTodayCount();

    const newCount = db.getTodayCount();
    console.log(`[Scheduler] ✅ Postado! (${newCount}/${MAX_DAILY} hoje)`);

    notifyTelegram(`📤 *Post automático enviado*\n${tweetUrl}\n📊 ${newCount}/${MAX_DAILY} hoje`);
  } catch (err) {
    console.error('[Scheduler] Erro no post automático:', err.message);
    notifyTelegram(`❌ Erro no post automático: ${err.message}`);
  }
}

async function autoFetch() {
  console.log('[Scheduler] Buscando novas promoções Shopee automaticamente...');

  try {
    const deals = await fetchBestDeals(10);
    let added = 0;

    for (const product of deals) {
      if (db.wasPostedRecently(product.name, 48)) {
        continue; // Evita repetir produto das últimas 48h
      }
      const generatedPost = await generatePost(product);
      db.addToQueue({ ...product, generatedPost });
      added++;
    }

    console.log(`[Scheduler] ${added} produtos adicionados à fila automaticamente.`);

    if (added > 0) {
      notifyTelegram(`🛍️ *Busca automática concluída*\n${added} promoção(ões) na fila.\nFila total: ${db.getPendingCount()}`);
    }
  } catch (err) {
    console.error('[Scheduler] Erro na busca automática:', err.message);
  }
}

function initScheduler() {
  // Agendamentos de postagem
  POST_SCHEDULES.forEach(schedule => {
    cron.schedule(schedule, autoPost, { timezone: TZ });
  });

  // Agendamentos de busca Shopee
  FETCH_SCHEDULES.forEach(schedule => {
    cron.schedule(schedule, autoFetch, { timezone: TZ });
  });

  console.log('[Scheduler] Cron jobs iniciados:');
  console.log('  Posts automáticos: 08h, 12h, 17h, 20h, 22h');
  console.log('  Busca Shopee: 07h, 11h30, 16h');
}

module.exports = { initScheduler, autoPost, autoFetch };
