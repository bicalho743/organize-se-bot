const OpenAI = require('openai');
const { getSystemPrompt } = require('./brainLoader');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = 'gpt-4o';
const TEMPERATURE_WRITER = 0.85;
const TEMPERATURE_CRITIC = 0.3;

// =============================================
// QUALITY PIPELINE MULTIAGENTE
// Escritor → Crítico → Editor
// =============================================

// Agente 1: Escritor — gera o post bruto
async function runWriter(product) {
  const systemPrompt = getSystemPrompt();

  const userPrompt = `Gere um post para o X sobre esta promoção:

Produto: ${product.name}
Preço atual: R$${product.price?.toFixed(2)}
Preço original: R$${product.originalPrice > 0 ? product.originalPrice.toFixed(2) : 'não disponível'}
Desconto: ${product.discountPct}%
Avaliação: ${product.rating} estrelas
Vendas: ${product.salesCount} unidades
Link afiliado: ${product.affiliateLink}

Gere o post agora. Só o texto, nada mais.`;

  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE_WRITER,
    max_tokens: 300,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return res.choices[0].message.content.trim();
}

// Agente 2: Crítico — analisa e aprova ou rejeita
async function runCritic(post) {
  const criticPrompt = `Você é um crítico rigoroso de posts de promoção no X.

Analise este post e responda com um JSON exato (sem markdown, sem explicação):
{
  "approved": true/false,
  "reason": "motivo resumido",
  "issues": ["lista de problemas encontrados"]
}

REJEITE se o post tiver qualquer um desses problemas:
- Linguagem de loja ou marketing (ex: "Aproveite!", "Não perca!", "Oferta exclusiva")
- Fake urgency sem base (ex: "Últimas unidades!" sem dado real)
- Emojis em excesso (mais de 2)
- Hashtags em excesso (mais de 1)
- Tom robótico ou de ChatGPT
- Informação inventada que não estava nos dados
- Muito longo (mais de 500 chars)
- Link ausente

POST A ANALISAR:
${post}`;

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
    return { approved: true, reason: 'Crítico falhou ao parsear, aprovando por padrão', issues: [] };
  }
}

// Agente 3: Editor — reescreve se necessário
async function runEditor(post, issues) {
  const systemPrompt = getSystemPrompt();

  const editorPrompt = `Reescreva este post corrigindo os seguintes problemas:
${issues.join('\n')}

POST ORIGINAL:
${post}

Retorne APENAS o texto reescrito, sem explicação.`;

  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE_WRITER,
    max_tokens: 300,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: editorPrompt },
    ],
  });

  return res.choices[0].message.content.trim();
}

// Pipeline completo
async function generatePost(product) {
  console.log(`[OpenAI] Gerando post para: ${product.name}`);

  let post = await runWriter(product);
  console.log('[OpenAI] Escritor:', post.substring(0, 80) + '...');

  // Até 2 tentativas de reescrita
  for (let attempt = 1; attempt <= 2; attempt++) {
    const critique = await runCritic(post);
    console.log(`[OpenAI] Crítico (tentativa ${attempt}):`, critique.approved ? '✅ aprovado' : `❌ rejeitado — ${critique.reason}`);

    if (critique.approved) break;

    if (attempt < 2) {
      post = await runEditor(post, critique.issues);
      console.log('[OpenAI] Editor reescreveu:', post.substring(0, 80) + '...');
    }
  }

  return post;
}

// Gera reply curto e humano para comentários
async function generateReply(originalTweet, context = '') {
  const replyPrompt = `Você é o Organize-se. Responda este comentário de forma direta, informal e humana.
Máximo 200 caracteres. Só o texto, sem explicação.

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
