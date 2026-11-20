const aiForm = document.getElementById('aiForm');
const aiInput = document.getElementById('query');
const aiMessages = document.getElementById('aiMessages');
const aiSend = document.getElementById('searchBtn');
let chatHistory = [];

function addAiMessage(text, role) {
  const el = document.createElement('div');
  el.className = 'ai-msg ' + role;
  el.textContent = text;
  aiMessages.appendChild(el);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  return el;
}

function formatAssistantMessage(el, text) {
  el.replaceChildren();
  let list = null;
  const addInline = (parent, line) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    for (const part of parts) {
      if (part.startsWith('**') && part.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else if (part.startsWith('*') && part.endsWith('*')) {
        const em = document.createElement('em');
        em.textContent = part.slice(1, -1);
        parent.appendChild(em);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    }
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = line.match(/^[-*]\s+(.+)/);
    if (bullet) {
      if (!list) {
        list = document.createElement('ul');
        el.appendChild(list);
      }
      const li = document.createElement('li');
      addInline(li, bullet[1]);
      list.appendChild(li);
      continue;
    }
    list = null;
    if (!line) continue;
    const p = document.createElement('p');
    addInline(p, line);
    el.appendChild(p);
  }
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function rememberChat(role, content) {
  chatHistory.push({ role, content: String(content).slice(0, 350) });
  if (chatHistory.length > 8) chatHistory = chatHistory.slice(-8);
}

function close(value, field, product) {
  if (!value) return true;
  const wanted = norm(value);
  const current = norm(product[field] || '');
  return current.includes(wanted) || wanted.includes(current);
}

function closeGender(value, product) {
  if (!value) return true;
  const wanted = norm(value);
  const current = norm(product.gender || '');
  if (/female|mujer|women|woman|femenin/.test(wanted)) return /mujer|femenin|dam/.test(current);
  if (/male|hombre|men|man|masculin/.test(wanted)) return /hombre|masculin|caballero/.test(current);
  return close(value, 'gender', product);
}

const CHAT_STOPWORDS = new Set(['la', 'el', 'los', 'las', 'lo', 'al', 'del', 'de', 'que', 'con', 'por', 'para', 'un', 'una', 'unos', 'unas', 'algo', 'necesito', 'quiero', 'busco', 'mostrame', 'dame', 'gusta', 'gustaria', 'me', 'mio', 'mia', 'años', 'ano']);

function chatTokens(value) {
  return norm(value).split(/[^a-z0-9$]+/).filter((word) => word.length > 1 && !CHAT_STOPWORDS.has(word));
}

function productWords(product) {
  return new Set(norm([product.name, product.category, product.store, product.mall, product.color, product.gender, product.description].join(' ')).split(/[^a-z0-9]+/).filter(Boolean));
}

function termMatches(term, words) {
  for (const [key, variants] of Object.entries(synonyms)) {
    if (term === key || variants.includes(term)) {
      return words.has(key) || variants.some((variant) => words.has(variant));
    }
  }
  return words.has(term);
}

function catalogSearch(args = {}, fallbackMessage = '') {
  const q = String(args.query || fallbackMessage || '');
  const ts = chatTokens(q);
  const intentIds = new Set(productsForIntent(q).map((p) => String(p.id)));
  const cheap = /\b(barato|barata|economic[oa]s?|oferta|accesible|regalo)\b/.test(norm(q));
  const wantsFemale = /hija|niña|nina|adolescente|femenin|mujer/.test(norm(q));
  const min = Number(args.min_price);
  let max = Number(args.max_price);
  if (cheap && Number.isFinite(max) && max < 500) max = 2500;
  const effectiveMax = Number.isFinite(max) ? max : (cheap ? 2500 : Infinity);

  const list = products
    .filter((p) => Number(p.price) > 0)
    .map((p) => {
      const words = productWords(p);
      const matched = ts.filter((term) => termMatches(term, words));
      const intent = intentIds.has(String(p.id));
      const affordable = cheap && Number(p.price) <= effectiveMax;
      return {
        p,
        ok: matched.length > 0 || intent || affordable,
        relevance: matched.length * 3 + (intent ? 6 : 0) + (affordable ? 1 : 0) - Number(p.price || 0) / 10000
      };
    })
    .filter((x) => x.ok)
    .filter((x) => Number(x.p.stock) > 0)
    .filter((x) => close(args.mall, 'mall', x.p))
    .filter((x) => close(args.store, 'store', x.p))
    .filter((x) => close(args.category, 'category', x.p))
    .filter((x) => closeGender(args.gender, x.p))
    .filter((x) => !wantsFemale || /mujer|femenin|unisex|dam/.test(norm(x.p.gender)))
    .filter((x) => !args.size || norm(x.p.size + ' ' + (x.p.sizes || '')).includes(norm(args.size)))
    .filter((x) => !args.color || norm(x.p.color).includes(norm(args.color)))
    .filter((x) => !Number.isFinite(min) || Number(x.p.price) >= min)
    .filter((x) => Number(x.p.price) <= effectiveMax);

  if (args.sort === 'low' || (cheap && !args.sort)) list.sort((a, b) => Number(a.p.price) - Number(b.p.price));
  else if (args.sort === 'high') list.sort((a, b) => Number(b.p.price) - Number(a.p.price));
  else list.sort((a, b) => b.relevance - a.relevance);

  const limit = Math.min(6, Math.max(3, Number(args.limit) || 5));
  return list.slice(0, limit).map((x) => x.p);
}

function addStockLinks(container, matched) {
  if (!matched.length) return;
  const heading = document.createElement('div');
  heading.className = 'ai-catalog-heading';
  heading.textContent = 'Del catálogo que usó la respuesta';
  container.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'ai-catalog-list';
  for (const p of matched) {
    const item = document.createElement('a');
    item.className = 'ai-catalog-item';
    item.href = p.url || '#';
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    item.setAttribute('aria-label', 'Ver ' + p.name + ' en ' + p.store);
    if (p.image) {
      const img = document.createElement('img');
      img.className = 'ai-catalog-thumb';
      img.src = p.image;
      img.alt = '';
      item.appendChild(img);
    } else {
      const thumb = document.createElement('span');
      thumb.className = 'ai-catalog-thumb';
      thumb.textContent = emoji(p);
      thumb.style.display = 'grid';
      thumb.style.placeItems = 'center';
      item.appendChild(thumb);
    }
    const info = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = p.name;
    info.appendChild(name);
    const meta = document.createElement('span');
    meta.className = 'ai-catalog-meta';
    meta.textContent = p.store + ' · ' + (p.color || p.category) + ' · Stock: ' + (p.stock || 'N/D');
    info.appendChild(meta);
    item.appendChild(info);
    const price = document.createElement('span');
    price.className = 'ai-catalog-price';
    price.textContent = '$ ' + Number(p.price || 0).toLocaleString('es-UY');
    item.appendChild(price);
    list.appendChild(item);
  }
  container.appendChild(list);
}

function localChatReply(message) {
  const clean = message.trim().toLocaleLowerCase('es-UY').replace(/[¡!¿?.,;:]+/g, ' ').replace(/\s+/g, ' ');
  if (/^(hola|buenas|buen día|buenas tardes|buenas noches|hey|holi|qué tal)$/.test(clean)) return '¡Hola! ¿Qué plan tenés en mente o qué prenda querés encontrar? También podemos afinar por talle, color o presupuesto.';
  if (/^(gracias|muchas gracias|genial gracias|perfecto gracias|listo gracias)$/.test(clean)) return '¡De nada! Si querés, seguimos buscando y ajustamos la ocasión, el talle, el color o el presupuesto.';
  if (/^(chau|adiós|hasta luego|nos vemos)$/.test(clean)) return '¡Hasta luego! Cuando quieras, seguimos armando opciones.';
  if (/^(qué puedes hacer|que puedes hacer|cómo funciona|como funciona|ayuda)$/.test(clean)) return 'Puedo ayudarte a elegir ropa para una ocasión, buscar una prenda y ajustar la búsqueda por tienda, estilo, talle, color o presupuesto. ¿Qué te gustaría resolver primero?';
  if (/^(qué me recomendas|que me recomendas|recomiéndame algo|recomiendame algo|sorprendeme|sorpréndeme|quiero algo lindo|busco algo|ayudame a elegir|ayúdame a elegir|quiero ropa)$/.test(clean)) return '¡Claro! ¿Para qué ocasión lo estás pensando y qué estilo te gusta? Si ya sabés tu talle o presupuesto, también me sirve.';
  return '';
}

async function postChat(payload) {
  const endpoint = window.CERCA_CHAT_ENDPOINT;
  if (!endpoint || endpoint.includes('TU-SUBDOMINIO')) {
    throw new Error('Configurá la URL del Worker en js/config.js');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'El chat está tomando una pausa. Probá nuevamente.');
  return data;
}

aiForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = aiInput.value.trim();
  if (!message) return;

  addAiMessage(message, 'user');
  const history = chatHistory.slice(-6).map((m) => ({ role: m.role, content: m.content }));
  rememberChat('user', message);
  aiInput.value = '';

  const localReply = localChatReply(message);
  if (localReply) {
    const bubble = addAiMessage('', 'assistant');
    formatAssistantMessage(bubble, localReply);
    rememberChat('assistant', localReply);
    return;
  }

  aiSend.disabled = true;
  aiSend.textContent = 'Buscando…';
  const pending = addAiMessage('Pensando qué buscar en el catálogo…', 'assistant');

  try {
    const plan = await postChat({ phase: 'plan', message, history });
    let reply;
    let matched = [];
    let searchArgs = null;

    if (plan.reply) {
      reply = plan.reply;
    } else {
      const call = plan.tool_call;
      if (!call || call.name !== 'search_products') throw new Error('No pude consultar el catálogo. Probá de nuevo.');
      searchArgs = call.arguments || {};
      pending.textContent = 'Buscando en el catálogo…';
      const results = catalogSearch(searchArgs, message);
      const answer = await postChat({
        phase: 'answer',
        message,
        history,
        tool_call: call,
        tool_result: { products: results }
      });
      reply = answer.reply;
      const ids = new Set((answer.product_ids || []).map(String));
      matched = products.filter((p) => ids.has(String(p.id)));
    }

    let clean = String(reply || '¿Me contás un poco más sobre la ocasión, el estilo o el talle que tenés en mente?');
    if (/excel|archivo de stock|cargar archivo/i.test(clean)) {
      clean = 'Contame qué ocasión tenés en mente, qué talle usás o qué estilo preferís, y seguimos desde ahí.';
    }

    formatAssistantMessage(pending, clean);
    addStockLinks(pending, matched);

    query = searchArgs?.query || message;
    recommendedIds = matched.length ? new Set(matched.map((p) => String(p.id))) : null;
    render();

    rememberChat('assistant', clean + (matched.length ? ' Productos del catálogo: ' + matched.map((p) => p.name).join(', ') : ''));
  } catch (err) {
    pending.textContent = err.message === 'Failed to fetch'
      ? 'La conexión con el chat está tomando una pausa. Probá nuevamente en unos segundos.'
      : 'Estoy preparando la respuesta. ' + err.message;
    rememberChat('assistant', pending.textContent);
  } finally {
    aiSend.disabled = false;
    aiSend.textContent = 'Buscar';
  }
});
