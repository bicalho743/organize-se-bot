const OpenAI = require('openai');
const { getSystemPrompt } = require('./brainLoader');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = 'gpt-4o';
const TEMPERATURE_WRITER = 0.85;
const TEMPERATURE_CRITIC = 0.3;

// =============================================
// QUALITY PIPELINE MULTIAGENTE
// Escritor → Crítico → Editor
// Gera DOIS textos: post principal + reply
// =============================================

async function runWriter(product) {
  const systemPrompt = getSystemPrompt();

  const userPrompt = `Gere DOIS textos para o X sobre esta promoção:

Produto: ${product.name}
Preço atual: R$${product.price?.toFixed(2)}
Preço original: ${product.originalPrice > 0 ? 'R$' + product.originalPrice.toFixed(2) : 'não disponível'}
Desconto: ${product.discountPct}%
Avaliação: ${product.rating} estrelas
Link afiliado: ${product.affiliateLink}

Retorne EXATAMENTE neste formato JSON (sem markdown, sem explicação):
{
  "main": "texto da curiosidade aqui — sem link, sem produto direto",
  "reply": "texto da promoção aqui — com link"
}`;

  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE_WRITER,
    max_tokens: 500,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = res.choices[0].message.content.trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function runCritic(posts) {
  const criticPrompt = `Você é um crítico rigoroso de posts para o X da persona "Gi" — mulher curiosa e bem-humorada.

Analise estes dois posts e responda com JSON exato (sem markdown):
{
  "approved": true/false,
  "reason": "motivo resumido",
  "issues": ["lista de problemas"]
}

REJEITE se:
- Post principal tiver link ou mencionar produto/preço diretamente
- Reply não tiver o link da promoção
- Tom for de loja, influencer ou robô
- Fake urgency ("últimas unidades!", "corre!")
- Maiúsculas para gritar
- Emojis em excesso (mais de 2 por post)
- Fato inventado ou não verificável
- Posts muito longos (main > 280 chars, reply > 280 chars)

POST PRINCIPAL:
${posts.main}

REPLY:
${posts.reply}`;

  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE_CRITIC,
    max_tokens: 200,
    messages: [{ role: 'user', content: criticPrompt }],
  });

  try {
    const raw = res.choices[0].message.content.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { approved: true, reason: 'Crítico falhou, aprovando por padrão', issues: [] };
  }
}

async function runEditor(posts, issues) {
  const systemPrompt = getSystemPrompt();

  const editorPrompt = `Reescreva estes dois posts corrigindo os problemas abaixo.

Problemas:
${issues.join('\n')}

POST PRINCIPAL ORIGINAL:
${posts.main}

REPLY ORIGINAL:
${posts.reply}

Retorne EXATAMENTE neste formato JSON (sem markdown):
{
  "main": "post principal reescrito",
  "reply": "reply reescrito"
}`;

  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE_WRITER,
    max_tokens: 500,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: editorPrompt },
    ],
  });

  const raw = res.choices[0].message.content.trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// Pipeline completo — retorna { main, reply }
async function generatePost(product) {
  console.log(`[OpenAI] Gerando post para: ${product.name}`);

  let posts = await runWriter(product);
  console.log('[OpenAI] Escritor — main:', posts.main?.substring(0, 60) + '...');

  for (let attempt = 1; attempt <= 2; attempt++) {
    const critique = await runCritic(posts);
    console.log(`[OpenAI] Crítico (tentativa ${attempt}):`, critique.approved ? '✅' : `❌ ${critique.reason}`);

    if (critique.approved) break;

    if (attempt < 2) {
      posts = await runEditor(posts, critique.issues);
    }
  }

  return posts; // { main: string, reply: string }
}

async function generateReply(originalTweet, context = '') {
  const replyPrompt = `Você é a Gi do @organizeepoupe. Responda este comentário de forma leve, direta e humana.
Máximo 200 caracteres. Só o texto.

${context ? `Contexto: ${context}` : ''}
Comentário: ${originalTweet}`;

  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.8,
    max_tokens: 100,
    messages: [{ role: 'user', content: replyPrompt }],
  });

  return res.choices[0].message.content.trim();
}

module.exports = { generatePost, generateReply };
