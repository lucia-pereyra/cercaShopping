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

const CHAT_STOPWORDS = new Set(['la', 'el', 'los', 'las', 'lo', 'al', 'del', 'de', 'que', 'con', 'por', 'para', 'un', 'una', 'unos', 'unas', 'algo', 'necesito', 'quiero', 'busco', 'mostrame', 'dame', 'gusta', 'gustaria', 'me', 'mio', 'mia', 'anos', 'ano', 'mas', 'otra', 'otro', 'otras', 'otros', 'hija', 'hijas', 'nina', 'ninas', 'adolescente', 'mujer', 'mujeres', 'hombre', 'hombres', 'femenino', 'femenina', 'masculino', 'masculina', 'damas', 'caballero', 'novia', 'novio', 'ella', 'barato', 'barata', 'economico', 'economica', 'economicos', 'economicas', 'oferta', 'accesible', 'hasta', 'menos', 'lucas']);

function chatTokens(value) {
  return norm(value).split(/[^a-z0-9$]+/).filter((word) => word.length > 1 && !CHAT_STOPWORDS.has(word));
}

function combinedMessage(message, history) {
  const lastUser = [...(Array.isArray(history) ? history : [])]
    .reverse()
    .find((m) => m && m.role === 'user' && typeof m.content === 'string')?.content || '';
  if (!lastUser) return String(message || '');
  const complement = /^(para|de|en|con|más|mas|otra|otro|otras|otros|me gusta|sí|si|también)\b/i.test(String(message || '').trim());
  return complement ? `${lastUser} — ${message}` : String(message || '');
}

function interpretChatQuery(args = {}, fallbackMessage = '', history = []) {
  const fromMessage = combinedMessage(fallbackMessage, history);
  const text = fromMessage.trim() ? fromMessage : String(args.query || '');
  const query = String(args.query || text);
  const audience = inferredAudience(text, args.gender || '');
  const cheap = /\b(barato|barata|economic[oa]s?|oferta|accesible|regalo|hasta|menos)\b/.test(norm(text)) || /\b\d+\s*(lucas|mil)\b/.test(norm(text));
  const minPrice = Number(args.min_price);
  const maxArg = Number(args.max_price);
  const maxPrice = Number.isFinite(maxArg) ? maxArg : (cheap ? 2500 : Infinity);
  return {
    query,
    queryTokens: chatTokens(query),
    audience,
    hard: {
      gender: audience.strict ? audience.value : '',
      mall: args.mall || '',
      store: args.store || '',
      category: args.category || '',
      color: args.color || '',
      size: args.size || '',
      minPrice: Number.isFinite(minPrice) ? minPrice : 0,
      maxPrice
    },
    soft: { cheap, avoidSport: isGoingOutQuery(text) },
    limit: Math.min(6, Math.max(3, Number(args.limit) || 5))
  };
}

function catalogMatches(args = {}, fallbackMessage = '', history = []) {
  return rankCatalog({ ...interpretChatQuery(args, fallbackMessage, history), all: false, full: true });
}

function catalogSearch(args = {}, fallbackMessage = '', history = []) {
  return catalogMatches(args, fallbackMessage, history).slice(0, 6);
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
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ai-catalog-item';
    item.setAttribute('data-product-open', String(p.id));
    item.setAttribute('aria-label', 'Ver detalle de ' + p.name + ' de ' + p.store);
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

document.getElementById('aiMessages').addEventListener('click', (e) => {
  const button = e.target.closest('[data-product-open]');
  if (!button) return;
  const card = [...document.querySelectorAll('#cards .card')].find((el) => el.dataset.productId === button.dataset.productOpen);
  if (!card) return;
  card.click();
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

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
    let allResults = [];
    let searchArgs = null;

    if (plan.reply) {
      reply = plan.reply;
    } else {
      const call = plan.tool_call;
      if (!call || call.name !== 'search_products') throw new Error('No pude consultar el catálogo. Probá de nuevo.');
      searchArgs = call.arguments || {};
      pending.textContent = 'Buscando en el catálogo…';
      allResults = catalogMatches(searchArgs, message, history);
      const results = allResults.slice(0, 30);
      const answer = await postChat({
        phase: 'answer',
        message,
        history,
        tool_call: call,
        tool_result: { products: results, total_matches: allResults.length }
      });
      reply = answer.reply;
      const ids = new Set((answer.product_ids || []).map(String));
      matched = allResults.filter((p) => ids.has(String(p.id)));
    }

    let clean = String(reply || '¿Me contás un poco más sobre la ocasión, el estilo o el talle que tenés en mente?');
    if (/excel|archivo de stock|cargar archivo/i.test(clean)) {
      clean = 'Contame qué ocasión tenés en mente, qué talle usás o qué estilo preferís, y seguimos desde ahí.';
    }

    formatAssistantMessage(pending, clean);
    addStockLinks(pending, matched);

    query = searchArgs?.query || message;
    aiInput.value = query;
    recommendedIds = allResults.length ? allResults.map((p) => String(p.id)) : null;
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
