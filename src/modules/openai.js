const OpenAI = require('openai');
const { getSystemPrompt } = require('./brainLoader');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = 'gpt-4o';

// =============================================
// WEB SEARCH — busca fato real antes de gerar
// =============================================
async function searchFact(productName) {
  try {
    const query = productName.substring(0, 60);
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-search-preview',
      temperature: 0.3,
      max_tokens: 200,
      web_search_options: {},
      messages: [{
        role: 'user',
        content: 'Encontre UM fato curioso, surpreendente ou pouco conhecido sobre: ' + query +
          '. Responda em UMA frase objetiva em português. Não mencione marca nem preço.'
      }],
    });

    // Extrai o texto da resposta
    const textBlock = res.choices[0].message.content;
    if (textBlock && textBlock.trim().length > 10) {
      console.log('[Search] Fato encontrado:', textBlock.substring(0, 80));
      return textBlock.trim();
    }
    return null;
  } catch (err) {
    console.warn('[Search] Web search falhou, seguindo sem fato:', err.message);
    return null;
  }
}


const TEMPERATURE_WRITER = 0.85;
const TEMPERATURE_CRITIC = 0.3;

// =============================================
// QUALITY PIPELINE MULTIAGENTE
// Escritor → Crítico → Editor
// Gera DOIS textos: post principal + reply
// =============================================

async function runWriter(product) {
  const systemPrompt = getSystemPrompt();

  const link = product.affiliateLink || '';
  const priceStr = product.price ? `R${product.price.toFixed(2)}` : 'preço não informado';
  const originalStr = product.originalPrice > 0 ? `R${product.originalPrice.toFixed(2)}` : null;
  const discountStr = product.discountPct ? `${product.discountPct}%` : null;

  const userPrompt = `Gere DOIS textos para o X sobre esta promoção.

DADOS DO PRODUTO:

- Nome: ${product.name}
- Preço: ${priceStr}${originalStr ? ' (antes: ' + originalStr + ')' : ''}${discountStr ? ' — desconto: ' + discountStr : ''}
- Link: ${link}${factHint}

REGRAS OBRIGATÓRIAS:
1. "main" = curiosidade relacionada ao produto/tema. SEM link. SEM mencionar marca ou preço. SEM nomear o produto diretamente.
2. "reply" = promoção direta. DEVE conter o link EXATAMENTE como fornecido: ${link}

Retorne EXATAMENTE este JSON (sem markdown, sem explicação, sem aspas extras):
{
  "main": "curiosidade aqui — sem link, sem preço, sem nomear produto",
  "reply": "promoção aqui — deve terminar com ${link}"
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

REJEITE APENAS se:
- Post principal tiver um link (URL) — isso é proibido
- Post principal mencionar preço ou valor monetário
- Reply NÃO tiver uma URL/link
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

// Garante que o link está no reply — injeta se o GPT esqueceu
function ensureLinkInReply(reply, link) {
  if (!link) return reply;
  if (reply.includes(link)) return reply;
  // Remove qualquer URL parcial que o GPT possa ter colocado errada
  const withoutBadUrl = reply.replace(/https?:\/\/\S+/g, '').trim();
  return withoutBadUrl + '\n' + link;
}

// Pipeline completo — retorna { main, reply }
async function generatePost(product) {
  console.log(`[OpenAI] Gerando post para: ${product.name}`);

  let posts = await runWriter(product);
  console.log('[OpenAI] Escritor — main:', posts.main?.substring(0, 60) + '...');

  // Força o link no reply antes de criticar
  posts.reply = ensureLinkInReply(posts.reply, product.affiliateLink);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const critique = await runCritic(posts);
    console.log(`[OpenAI] Crítico (tentativa ${attempt}):`, critique.approved ? '✅' : `❌ ${critique.reason}`);

    if (critique.approved) break;

    if (attempt < 2) {
      posts = await runEditor(posts, critique.issues);
      // Garante link novamente após edição
      posts.reply = ensureLinkInReply(posts.reply, product.affiliateLink);
    }
  }

  // Garante link uma última vez antes de retornar
  posts.reply = ensureLinkInReply(posts.reply, product.affiliateLink);

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
