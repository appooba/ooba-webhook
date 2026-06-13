const VT = "ooba2026";
const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const OAI_KEY = process.env.OPENAI_API_KEY || "";
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

const SYS = `Você é o Vendedor OOBA, consultor virtual de mídia indoor no WhatsApp.

PERSONALIDADE: consultivo, próximo, usa dados, mensagens curtas (máx 2-3 linhas), estilo WhatsApp.

REGRAS ABSOLUTAS:
- NUNCA fale preço antes de gerar valor
- NUNCA recomece a conversa — continue exatamente de onde parou
- NUNCA repita pergunta já respondida
- NUNCA faça mais de 1 pergunta por mensagem
- Se o cliente resistir, aprofunde — NÃO recomece o fluxo
- Responda SEMPRE em português do Brasil

FLUXO (siga a ordem, nunca volte atrás):
1. ABERTURA: apresente-se brevemente e pergunte "Hoje quais tipos de marketing você utiliza?"
2. VALIDAÇÃO: elogie o que ele usa e apresente indoor como complemento
3. DIFERENCIAIS: use dados (pessoa fica 1h no local, vídeo 15s aparece 6-7x, roda 6h-meia-noite, +70mil pessoas/mês, OOH +123% 2017-2024)
4. ENTENDIMENTO: pergunte sobre o negócio e público-alvo
5. PROPOSTA: indique os pontos ideais com dados de fluxo
6. FECHAMENTO: apresente preços e feche

PONTOS (Porto Feliz e Boituva):
- Sueli Bolos Porto Feliz: 18.300/mês
- Sueli Bolos Boituva: 15.100/mês
- Academia R2 Shopping: 13.240/mês
- Pizzaria Rocks: 10.900/mês
- Pizzaria Monções: 10.500/mês
- Restaurante Araras: 9.800/mês
Total: +70 mil pessoas/mês

PREÇOS (só após gerar valor):
1pt: R$400/mês | R$200/mês anual
2pt: R$550/mês | R$450/mês anual
3pt: R$650/mês | R$550/mês anual
4pt: R$750/mês | R$650/mês anual
5pt+: R$850/mês | R$750/mês anual
Bônus anual +3pts: rodízio. +5pts: 1º vídeo grátis + carrossel 2 vídeos.

CONTATO: (11) 92127-6113 | contato@ooba.com.br | www.ooba.com.br`;

// Histórico em memória (fallback se Redis não configurado)
const memHist = {};

async function getHist(phone) {
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      const res = await fetch(`${REDIS_URL}/get/hist:${phone}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
      });
      const d = await res.json();
      if (d?.result) {
        const msgs = JSON.parse(d.result);
        console.log(`Redis: ${msgs.length} msgs para ${phone}`);
        return msgs;
      }
    } catch(e) { console.error("Redis get:", e.message); }
  }
  return memHist[phone] || [];
}

async function saveHist(phone, msgs) {
  const data = JSON.stringify(msgs.slice(-30));
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      await fetch(`${REDIS_URL}/set/hist:${phone}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ value: data, ex: 86400 * 30 }) // 30 dias
      });
      console.log(`Redis: salvo ${msgs.length} msgs para ${phone}`);
      return;
    } catch(e) { console.error("Redis set:", e.message); }
  }
  memHist[phone] = msgs.slice(-30);
  console.log(`Mem: salvo ${msgs.length} msgs para ${phone}`);
}

async function sendMsg(to, body) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } })
  });
  const d = await res.json();
  if (d?.error) console.error("WA error:", JSON.stringify(d.error));
  else console.log("WA sent:", d?.messages?.[0]?.id);
}

async function replyAI(txt, phone) {
  const msgs = await getHist(phone);
  msgs.push({ role: "user", content: txt });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYS }, ...msgs],
      max_tokens: 400,
      temperature: 0.6
    })
  });

  if (!res.ok) { console.error("OpenAI:", res.status, await res.text()); return ""; }

  const d = await res.json();
  const rep = d?.choices?.[0]?.message?.content?.trim() || "";
  if (rep) {
    msgs.push({ role: "assistant", content: rep });
    await saveHist(phone, msgs);
  }
  return rep;
}

const processedMsgs = new Set();

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
    if (mode === "subscribe" && token === VT) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    try {
      const v = req.body?.entry?.[0]?.changes?.[0]?.value;
      if (v?.statuses) return res.json({ ok: true });

      const m = v?.messages?.[0];
      if (!m || m.type !== "text") return res.json({ ok: true });

      const msgId = m.id;
      if (processedMsgs.has(msgId)) {
        console.log("Duplicata ignorada:", msgId);
        return res.json({ ok: true });
      }
      processedMsgs.add(msgId);
      if (processedMsgs.size > 200) processedMsgs.delete(processedMsgs.values().next().value);

      const from = m.from;
      const txt = m?.text?.body?.trim() || "";
      if (!from || !txt) return res.json({ ok: true });

      console.log(`IN [${from}]: ${txt}`);
      const rep = await replyAI(txt, from);
      if (rep) {
        console.log(`OUT [${from}]: ${rep.substring(0, 80)}...`);
        await sendMsg(from, rep);
      }
      return res.json({ ok: true });
    } catch(e) {
      console.error("ERR:", e.message);
      return res.status(500).json({ error: String(e) });
    }
  }

  return res.status(405).json({ error: "method not allowed" });
};
