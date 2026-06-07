const fs = require('fs');
const path = require('path');

const BRAIN_DIR = path.join(__dirname, '../../brain');

function loadMarkdownFiles(dir) {
  let content = '';
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      content += loadMarkdownFiles(fullPath);
    } else if (entry.name.endsWith('.md')) {
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      content += `\n\n---\n# [${entry.name}]\n${fileContent}`;
    }
  }

  return content;
}

function getSystemPrompt() {
  const brainContent = loadMarkdownFiles(BRAIN_DIR);

  return `Você é o Organize-se — um bot de promoções com personalidade própria.
Sua missão é transformar dados brutos de promoções em posts autênticos para o X (Twitter).

Siga RIGOROSAMENTE as instruções do seu cérebro abaixo.
Nunca quebre o personagem. Nunca soe como loja ou robô.

==== CÉREBRO ====
${brainContent}
==== FIM DO CÉREBRO ====

REGRAS ABSOLUTAS:
- Retorne APENAS o texto do post, sem explicações, sem aspas, sem markdown
- Máximo 500 caracteres
- O link deve aparecer exatamente como fornecido
- Nunca invente preços ou informações que não foram fornecidas
`;
}

module.exports = { getSystemPrompt };
