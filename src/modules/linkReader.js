const axios = require('axios');

// =============================================
// Extrai informações de produto a partir de URL
// Funciona com Shopee, Amazon, Magalu, etc.
// =============================================

// Detecta se o texto é uma URL
function isUrl(text) {
  return /^https?:\/\//i.test(text.trim());
}

// Expande URLs encurtadas (bit.ly, shopee.com.br/A/xxx, etc.)
async function expandUrl(url) {
  try {
    const res = await axios.get(url, {
      maxRedirects: 10,
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return res.request.res.responseUrl || url;
  } catch (err) {
    return url;
  }
}

// Extrai dados básicos do HTML da página
async function extractProductFromUrl(url) {
  try {
    const expanded = await expandUrl(url);
    console.log(`[LinkReader] URL expandida: ${expanded}`);

    const res = await axios.get(expanded, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });

    const html = res.data;

    // Extrai título
    const titleMatch =
      html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;

    // Extrai preço (padrões comuns BR)
    const priceMatch =
      html.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i) ||
      html.match(/"price":\s*"?(\d+(?:\.\d+)?)"?/i);
    const priceRaw = priceMatch ? priceMatch[1].replace('.', '').replace(',', '.') : null;
    const price = priceRaw ? parseFloat(priceRaw) : null;

    // Extrai preço original / de
    const originalPriceMatch =
      html.match(/de\s+R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i) ||
      html.match(/"original_price":\s*"?(\d+(?:\.\d+)?)"?/i);
    const originalPriceRaw = originalPriceMatch
      ? originalPriceMatch[1].replace('.', '').replace(',', '.')
      : null;
    const originalPrice = originalPriceRaw ? parseFloat(originalPriceRaw) : null;

    // Calcula desconto
    const discountPct =
      price && originalPrice && originalPrice > price
        ? Math.round(((originalPrice - price) / originalPrice) * 100)
        : null;

    // Extrai imagem
    const imageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    const imageUrl = imageMatch ? imageMatch[1] : null;

    // Tenta extrair nome da URL se o scraping falhou
    let finalName = title;
    if (!finalName || finalName === 'Shopee' || finalName.length < 5) {
      // Extrai slug da URL: /Nome-do-Produto-i.xxx.xxx
      const slugMatch = expanded.match(/\/([^/?]+)-i\.\d+\.\d+/);
      if (slugMatch) {
        finalName = slugMatch[1].replace(/-/g, ' ').toLowerCase();
      }
      // Tenta pegar do path da URL encurtada
      if (!finalName || finalName.length < 5) {
        const pathMatch = url.match(/shopee\.com\.br\/([^/?&]+)/);
        if (pathMatch) finalName = pathMatch[1].replace(/-/g, ' ').toLowerCase();
      }
    }

    return {
      name: finalName || 'Produto',
      price,
      originalPrice,
      discountPct,
      affiliateLink: url, // usa o link original como afiliado
      imageUrl,
      rating: null,
      salesCount: null,
      category: null,
      sourceUrl: expanded,
    };
  } catch (err) {
    console.error('[LinkReader] Erro ao extrair produto:', err.message);
    return {
      name: 'Produto',
      price: null,
      originalPrice: null,
      discountPct: null,
      affiliateLink: url,
      imageUrl: null,
      rating: null,
      salesCount: null,
      category: null,
    };
  }
}

module.exports = { isUrl, extractProductFromUrl };
