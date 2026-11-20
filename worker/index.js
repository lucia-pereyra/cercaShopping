const baseHeaders = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=UTF-8',
  'Cache-Control': 'no-store'
});

function json(body, env, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: baseHeaders(env) });
}

const PLAN_SYSTEM_PROMPT = `Sos Cerca, una asesora de compras de ropa en Uruguay. Respondés siempre en español neutro, claro y profesional.
Tenés UNASOLA herramienta disponible: search_products. Busca en el catálogo real y devuelve prendas con nombre, precio, tienda, shopping, categoría, stock, talles, color y género.
No tenés acceso directo al catálogo: para cualquier consulta sobre prendas, precios, stock, tiendas o recomendaciones, tenés que pedir la herramienta.
Respondé SOLO con un objeto JSON válido, sin texto afuera, sin Markdown y sin explicaciones:
{"tool":"search_products","arguments":{"query":"frase concreta de búsqueda","limit":5}}
Si es un saludo o una pregunta general que no necesita catálogo, respondé:
{"tool":"none","answer":"tu respuesta breve"}
Reglas para "arguments":
- "query": frase concreta en español con palabras útiles, por ejemplo "vestido elegante negro" o "jeans hombre barato". No copies la conversación completa.
- "limit": entero entre 3 y 6.
- "mall", "store", "category", "gender", "min_price", "max_price": opcionales. Usalos solo si la persona los pide o si se infieren claramente del historial.
- Usá el historial solo para estilo, ocasión, categoría y tienda. No arrastres filtros numéricos de turnos anteriores salvo que la persona los repita.
- Si la consulta actual es un complemento ("para mi hija de 15 años", "más barato", "mostrame otros"), combiná el último mensaje del historial: por ejemplo "regalo económico para hija adolescente".
- Los precios están en UYU: "económico", "barato" o "regalo" implican max_price entre 1500 y 3000. NUNCA uses max_price menor a 500 salvo que la persona dé un número explícito.
- Si la herramienta no devuelve productos, decí que no los tenés. Nunca sugieras categorías distintas ni productos inventados para rellenar.
No inventes datos del catálogo.`;

const ANSWER_SYSTEM_PROMPT = `Sos Cerca, una asesora de compras de ropa en Uruguay. Respondés siempre en español neutro, claro y profesional, con tono amable y directo.
Evitá jerga, modismos y expresiones coloquiales como "che", "mirá", "copado", "te tiro", "dale", "baratito" o "lucas". Escribí los precios siempre en UYU con número.
Tenés disponibles SOLAMENTE los productos que devolvió la herramienta search_products. Nunca inventes productos, precios, talles, tiendas ni stock.
Elegí vos cuáles productos merecen ser mencionados, sin limitarte al orden de la lista. Citá el nombre exacto de cada prenda, su precio en UYU, la tienda y el stock. Como máximo seis opciones.
Elegí como máximo seis de los productos listados y mencioná solo esos. No pidas aclaraciones por la cantidad de coincidencias.
Si faltan datos para recomendar, hacé una pregunta concreta. No menciones la herramienta, el JSON ni que sos un modelo.
Si los productos devueltos no coinciden con lo pedido, respondé que no tenés esos productos y poné "product_ids":[] . No recomiendes productos de otras categorías para rellenar.
Si hay productos válidos, citá al menos uno en "product_ids". Nunca digas "no encontré" si vas a devolver ids.
Respondé SOLO con un objeto JSON válido, sin texto afuera ni Markdown:
{"answer":"tu respuesta en español neutro y profesional","product_ids":[id1,id2]}
"product_ids" son los ids numéricos de los productos que citaste, tomados de la lista de la herramienta. No inventes ids.`;

function cleanReply(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function extractJson(text) {
  const cleaned = cleanReply(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function historyMessages(history) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'user' && typeof m.content === 'string')
    .slice(-2)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 400) }));
}

function effectiveMessage(message, history) {
  const lastUser = [...(Array.isArray(history) ? history : [])]
    .reverse()
    .find((m) => m && m.role === 'user' && typeof m.content === 'string')?.content || '';
  if (!lastUser) return message;
  const filler = /^(para|de|en|con|más|mas|otra|otro|otras|otros|me gusta|sí|si|también)\b/i.test(message.trim());
  return filler ? `${lastUser} — ${message}` : message;
}

function buildPlanMessages(message, history) {
  return [
    { role: 'system', content: PLAN_SYSTEM_PROMPT },
    ...historyMessages(history),
    { role: 'user', content: `CONSULTA ACTUAL:\n${effectiveMessage(message, history)}` }
  ];
}

function buildAnswerMessages(message, history, call, toolResult) {
  const results = Array.isArray(toolResult?.products) ? toolResult.products : [];
  const products = results.slice(0, 30).map((p, i) => {
    const pieces = [
      `id: ${p.id ?? i + 1}`,
      `nombre: ${p.name || ''}`,
      `precio UYU: ${p.price ?? ''}`,
      `tienda: ${p.store || ''}`,
      `shopping: ${p.mall || ''}`,
      `categoría: ${p.category || ''}`,
      `stock: ${p.stock ?? ''}`,
      `talles: ${p.sizes || p.size || ''}`,
      `color: ${p.color || ''}`,
      `género: ${p.gender || ''}`,
      `descripción: ${p.description || ''}`
    ];
    return `${i + 1}. ${pieces.join(' | ')}`;
  }).join('\n');

  return [
    { role: 'system', content: ANSWER_SYSTEM_PROMPT },
    ...historyMessages(history),
    {
      role: 'user',
      content:
        `CONSULTA ACTUAL:\n${effectiveMessage(message, history)}\n\n` +
        `HERRAMIENTA: search_products(${JSON.stringify(call?.arguments || {})})\n\n` +
        `PRODUCTOS DEVUELTOS POR LA HERRAMIENTA:\n${products || '(ninguno)'}\n\n` +
        `Respondé con el JSON indicado.`
    }
  ];
}

function cleanQuery(value) {
  return String(value || '')
    .replace(/^(necesito|quiero|busco|me gusta lo de|me gustaría|me gustaria|mostrame|dame)\b/i, '')
    .replace(/^(algo|un|una|unos|unas)\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseToolCall(text, fallbackMessage) {
  const data = extractJson(text);
  if (data && (data.tool === 'none' || data.answer) && data.tool !== 'search_products') {
    const answer = String(data.answer || '').trim();
    if (answer) return { name: 'none', answer };
  }

  const rawArgs = (data && (data.arguments || data.args)) || {};
  const limit = Math.min(6, Math.max(3, Number(rawArgs.limit) || 5));
  const args = { query: cleanQuery(rawArgs.query || fallbackMessage).slice(0, 200) || cleanQuery(fallbackMessage).slice(0, 200), limit };
  for (const key of ['mall', 'store', 'category', 'gender', 'size', 'color']) {
    if (rawArgs[key] != null && String(rawArgs[key]).trim()) args[key] = String(rawArgs[key]).trim().slice(0, 120);
  }
  for (const key of ['min_price', 'max_price']) {
    const value = Number(rawArgs[key]);
    if (Number.isFinite(value) && value >= 0) args[key] = value;
  }
  if (rawArgs.sort === 'low' || rawArgs.sort === 'high') args.sort = rawArgs.sort;

  return { name: 'search_products', arguments: args };
}

function polishTone(text) {
  return String(text || '')
    .replace(/^\s*(che|mir[áa]|mira)[,\s]+/i, '')
    .replace(/\b(\d+)\s+lucas\b/gi, (_, n) => `${Number(n) * 1000} UYU`)
    .replace(/\blucas\b/gi, 'UYU')
    .replace(/\bcopad[oa]s?\b/gi, 'interesantes')
    .replace(/\bte tiro\b/gi, 'te recomiendo')
    .replace(/\bbaratitos?\b/gi, 'económicos')
    .replace(/\bdale\b/gi, '')
    .trim();
}

function answerText(data, raw) {
  const value = data?.answer ?? data?.reply ?? data?.text;
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return answerText(value, raw);
  return cleanReply(raw).trim();
}

function parseAnswer(text, results) {
  const data = extractJson(text);
  const allowed = new Set((Array.isArray(results) ? results : []).map((p) => String(p.id)));
  const hasIdsField = data && Object.prototype.hasOwnProperty.call(data, 'product_ids');
  let ids = hasIdsField && Array.isArray(data.product_ids)
    ? data.product_ids.map(String).filter((id) => allowed.has(id))
    : [...allowed].slice(0, 6);
  const answer = polishTone(answerText(data, text));
  if (!allowed.size || /no (encontr|teng|hay|dispongo)|sin stock|no coincide/i.test(answer)) ids = [];
  return { answer, product_ids: ids.slice(0, 6) };
}

function extractModelText(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || depth > 4) return '';
  return extractModelText(
    value.response ?? value.choices?.[0]?.message?.content ?? value.result ?? value.output_text ?? '',
    depth + 1
  );
}

async function runModel(env, model, messages, maxTokens) {
  const result = await env.AI.run(model, {
    messages,
    max_tokens: maxTokens,
    temperature: 0.4
  });
  const text = extractModelText(result);
  if (!text) throw new Error('Respuesta vacía');
  return text;
}

async function generate(env, messages, maxTokens = 900) {
  const primary = env.CHAT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const secondary = env.AI_MODEL || '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b';
  const nimReady = Boolean(env.NVIDIA_NIM_API_KEY && env.NVIDIA_NIM_URL);
  try {
    return await runModel(env, primary, messages, maxTokens);
  } catch {
    try {
      return await runModel(env, secondary, messages, maxTokens);
    } catch (error) {
      if (!nimReady) throw error;
      return callNvidiaNim(env, messages, Math.min(maxTokens, 700));
    }
  }
}

async function callNvidiaNim(env, messages, maxTokens = 700) {
  const base = String(env.NVIDIA_NIM_URL).replace(/\/+$/, '');
  const url = base.endsWith('/chat/completions')
    ? base
    : `${base.replace(/\/v1$/, '')}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.NVIDIA_NIM_API_KEY}`
    },
    body: JSON.stringify({
      model: env.NVIDIA_NIM_MODEL || 'meta/llama-3.1-70b-instruct',
      messages,
      max_tokens: maxTokens,
      temperature: 0.4,
      stream: false
    })
  });
  if (!response.ok) throw new Error(`NIM ${response.status}`);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Respuesta NIM vacía');
  return text;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: baseHeaders(env) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Método no permitido' }, env, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'La consulta quedó lista para reintentar cuando vuelva la conexión.' }, env, 400);
    }

    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    if (!message) {
      return json({ error: 'Escribí qué estás buscando.' }, env, 400);
    }

    const history = payload.history;
    const phase = payload.phase === 'answer' ? 'answer' : 'plan';

    try {
      if (phase === 'plan') {
        const text = await generate(env, buildPlanMessages(message, history), 900);
        const toolCall = parseToolCall(text, effectiveMessage(message, history));
        if (toolCall.name === 'none') return json({ reply: polishTone(toolCall.answer) }, env);
        return json({ tool_call: toolCall, pending: 'Buscando en el catálogo…' }, env);
      }

      const call = payload.tool_call;
      const results = Array.isArray(payload.tool_result?.products) ? payload.tool_result.products : [];
      if (!call || call.name !== 'search_products') {
        return json({ error: 'La búsqueda no se pudo iniciar. Probá nuevamente.' }, env, 400);
      }

      const text = await generate(env, buildAnswerMessages(message, history, call, payload.tool_result), 900);
      const parsed = parseAnswer(text, results);
      if (!parsed.answer) throw new Error('Respuesta vacía');
      return json({ reply: parsed.answer, product_ids: parsed.product_ids, tool_call: call }, env);
    } catch {
      return json({ error: 'El chat está tomando una pausa. Probá nuevamente.' }, env, 502);
    }
  }
};
