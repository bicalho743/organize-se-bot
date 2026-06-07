const axios = require('axios');
const crypto = require('crypto');

// =============================================
// SHOPEE AFFILIATE API
// Documentação: https://open.shopee.com/documents/v2/OpenPlatform/106/36
// =============================================

const SHOPEE_BASE_URL = 'https://open-api.affiliate.shopee.com.br';

// Categorias populares BR (IDs da Shopee)
const CATEGORIES = {
  ELECTRONICS:    100639,
  HOME_LIVING:    100012,
  FASHION:        100008,
  HEALTH_BEAUTY:  100031,
  SPORTS:         100022,
  TOYS:           100048,
  AUTOMOTIVE:     100039,
  FOOD:           100052,
};

// Mínimo de desconto para considerar a promo válida
const MIN_DISCOUNT_PCT = 20;
const MIN_RATING = 4.0;
const MIN_SALES = 50;

function generateShopeeSignature(appId, secretKey, timestamp, payload) {
  const baseStr = `${appId}${timestamp}${payload}`;
  return crypto.createHmac('sha256', secretKey).update(baseStr).digest('hex');
}

function getHeaders(payload = '') {
  const appId = process.env.SHOPEE_APP_ID;
  const secretKey = process.env.SHOPEE_SECRET_KEY;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign = generateShopeeSignature(appId, secretKey, timestamp, payload);

  return {
    'Authorization': `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${sign}`,
    'Content-Type': 'application/json',
  };
}

// Busca produtos mais vendidos por categoria
async function getTopProducts(categoryId, limit = 20) {
  const appId = process.env.SHOPEE_APP_ID;
  const accessToken = process.env.SHOPEE_ACCESS_TOKEN;

  const payload = JSON.stringify({
    sortType: 2,        // 2 = sales, 1 = relevance, 3 = price asc, 4 = price desc
    limit,
    page: 1,
    categoryId,
    accessToken,
  });

  try {
    const res = await axios.post(
      `${SHOPEE_BASE_URL}/api/search/items`,
      payload,
      { headers: getHeaders(payload), timeout: 10000 }
    );

    const items = res.data?.data?.item || [];
    return filterAndNormalizeItems(items);
  } catch (err) {
    console.error(`[Shopee] Erro ao buscar categoria ${categoryId}:`, err.response?.data || err.message);
    return [];
  }
}

// Busca flash deals atuais
async function getFlashDeals(limit = 20) {
  const accessToken = process.env.SHOPEE_ACCESS_TOKEN;

  const payload = JSON.stringify({
    limit,
    accessToken,
  });

  try {
    const res = await axios.post(
      `${SHOPEE_BASE_URL}/api/flash_sale/items`,
      payload,
      { headers: getHeaders(payload), timeout: 10000 }
    );

    const items = res.data?.data?.item || [];
    return filterAndNormalizeItems(items);
  } catch (err) {
    console.error('[Shopee] Erro ao buscar flash deals:', err.response?.data || err.message);
    return [];
  }
}

// Gera link de afiliado rastreável
async function generateAffiliateLink(itemUrl) {
  const accessToken = process.env.SHOPEE_ACCESS_TOKEN;

  const payload = JSON.stringify({
    originUrl: itemUrl,
    accessToken,
  });

  try {
    const res = await axios.post(
      `${SHOPEE_BASE_URL}/api/link/generate`,
      payload,
      { headers: getHeaders(payload), timeout: 8000 }
    );

    return res.data?.data?.affiliateLink || itemUrl;
  } catch (err) {
    console.error('[Shopee] Erro ao gerar link afiliado:', err.message);
    return itemUrl;
  }
}

function filterAndNormalizeItems(items) {
  return items
    .filter(item => {
      const discount = item.priceDiscountRate || 0;
      const rating = item.itemRating?.ratingAvg || 0;
      const sales = item.historicalSold || 0;
      return discount >= MIN_DISCOUNT_PCT && rating >= MIN_RATING && sales >= MIN_SALES;
    })
    .map(item => ({
      id: item.itemId,
      shopId: item.shopId,
      name: item.itemName,
      price: (item.priceMin || 0) / 100000,              // Shopee usa preço * 100000
      originalPrice: (item.priceMinBeforeDiscount || 0) / 100000,
      discountPct: item.priceDiscountRate || 0,
      rating: item.itemRating?.ratingAvg || 0,
      salesCount: item.historicalSold || 0,
      imageUrl: item.image ? `https://cf.shopee.com.br/file/${item.image}` : null,
      shopeeUrl: `https://shopee.com.br/product/${item.shopId}/${item.itemId}`,
      category: item.catId,
    }))
    .sort((a, b) => b.discountPct - a.discountPct);  // Maior desconto primeiro
}

// Busca promos em múltiplas categorias e retorna o melhor mix
async function fetchBestDeals(maxResults = 10) {
  console.log('[Shopee] Buscando melhores promoções...');

  const categoryKeys = Object.keys(CATEGORIES);
  const randomCategories = categoryKeys.sort(() => Math.random() - 0.5).slice(0, 3);

  const [flashDeals, ...categoryResults] = await Promise.all([
    getFlashDeals(15),
    ...randomCategories.map(cat => getTopProducts(CATEGORIES[cat], 10)),
  ]);

  const allItems = [...flashDeals, ...categoryResults.flat()];

  // Remove duplicados pelo ID
  const seen = new Set();
  const unique = allItems.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  // Gera links afiliados em paralelo (limita a 5 por vez para não sobrecarregar)
  const withLinks = [];
  for (let i = 0; i < Math.min(unique.length, maxResults); i++) {
    const item = unique[i];
    const affiliateLink = await generateAffiliateLink(item.shopeeUrl);
    withLinks.push({ ...item, affiliateLink });
  }

  console.log(`[Shopee] ${withLinks.length} produtos qualificados encontrados.`);
  return withLinks;
}

module.exports = { fetchBestDeals, getTopProducts, getFlashDeals, CATEGORIES };
