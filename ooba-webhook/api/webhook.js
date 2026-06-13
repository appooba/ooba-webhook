const VT = "ooba2026";
const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const OAI_KEY = process.env.OPENAI_API_KEY || "";
const BASE44_API_KEY = process.env.BASE44_API_KEY || "";
const BASE44_APP_ID = "69f645345c37a4db77e0e07d";

const SYS = `Você é o Vendedor OOBA, consultor virtual de mídia indoor no WhatsApp.

PERSONALIDADE: consultivo, próximo, usa dados, mensagens curtas (máx 2-3 linhas por vez), estilo WhatsApp.

REGRAS ABSOLUTAS:
- NUNCA fale preço antes de gerar valor
- NUNCA recomece a conversa — continue exatamente de onde parou
- NUNCA repita uma pergunta que o cliente já respondeu
- NUNCA faça mais de 1 pergunta por mensagem
- Se o cliente resistir, aprofunde o argumento — NÃO recomece o fluxo
- Responda SEMPRE em português do Brasil

FLUXO DE VENDAS (siga a ordem, nunca volte atrás):
1. ABERTURA: apresente-se e pergunte "Hoje quais tipos de marketing você utiliza?"
2. VALIDAÇÃO: elogie o que ele usa e apresente indoor como complemento
3. DIFERENCIAIS: use dados (1h no local, vídeo 15s aparece 6-7x, roda 6h-meia-noite, +70mil pessoas/mês, OOH +123% 2017-2024)
4. ENTENDIMENTO: pergunte sobre o negócio e qual público quer atingir
5. PROPOSTA: indique os pontos ideais com base no negócio dele
6. FECHAMENTO: apresente preços e feche

PONTOS DISPONÍVEIS (Porto Feliz e Boituva):
- Sueli Bolos Porto Feliz: 18.300 pessoas/mês
- Academia R2 Shopping: 13.240 pessoas/mês
- Pizzaria Rocks: 10.900 pessoas/mês
- Pizzaria Monções: 10.500 pessoas/mês
- Restaurante Araras: 9.800 pessoas/mês
- Sueli Bolos Boituva: 15.100 pessoas/mês
Total: +70 mil pessoas/mês

PREÇOS (só após gerar valor):
1pt: R$400/mês ou R$200/mês anual
2pt: R$550/mês ou R$450/mês anual
3pt: R$650/mês ou R$550/mês anual
4pt: R$750/mês ou R$650/mês anual
5pt: R$850/mês ou R$750/mês anual
Bônus anual +3pts: rodízio entre locais. +5pts: 1º vídeo grátis + carrossel 2 vídeos.

CONTATO FINAL: (11) 92127-6113 | contato@ooba.com.br | www.ooba.com.br`;

const BASE_URL = `https://base44.app/api/apps/${BASE44_APP_ID}`;

async function getHist(phone) {
  try {
    const res = await fetch(`${BASE_URL}/entities/ConversationHistory/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": BASE44_API_KEY },
      body: JSON.stringify({ phone })
    });
    if (!res.ok) {
      console.error("getHist HTTP:", res.status, await res.text());
      return { id: undefined, msgs: [] };
    }
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const msgs = JSON.parse(data[0].messages || "[]");
      console.log(`Histórico carregado: ${msgs.length} mensagens para ${phone}`);
      return { id: data[0].id, msgs };
    }
  } catch(e) { console.error("getHist:", e.message); }
  return { id: undefined, msgs: [] };
}

async function saveHist(phone, id, msgs) {
  try {
    const payload = { phone, messages: JSON.stringify(msgs.slice(-30)) };
    const url = id
      ? `${BASE_URL}/entities/ConversationHistory/${id}`
      : `${BASE_URL}/entities/ConversationHistory`;
    const method = id ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "x-api-key": BASE44_API_KEY },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error("saveHist HTTP:", res.status, await res.text());
    } else {
      console.log(`Histórico salvo: ${msgs.length} mensagens para ${phone}`);
    }
  } catch(e) { console.error("saveHist:", e.message); }
}

async function sendMsg(to, body) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } })
  });
  const d = await res.json();
  if (d?.error) {
    console.error("WA send error:", JSON.stringify(d.error));
  } else {
    console.log("WA sent:", d?.messages?.[0]?.id);
  }
}

async function replyAI(txt, phone) {
  const { id, msgs } = await getHist(phone);
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

  if (!res.ok) {
    console.error("OpenAI HTTP:", res.status, await res.text());
    return "";
  }

  const d = await res.json();
  const rep = d?.choices?.[0]?.message?.content?.trim() || "";
  if (rep) {
    msgs.push({ role: "assistant", content: rep });
    await saveHist(phone, id, msgs);
  }
  return rep;
}

// Deduplicação de mensagens já processadas
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
      if (processedMsgs.size > 200) {
        const first = processedMsgs.values().next().value;
        processedMsgs.delete(first);
      }

      const from = m.from;
      const txt = m?.text?.body?.trim() || "";
      if (!from || !txt) return res.json({ ok: true });

      console.log(`IN [${from}]: ${txt}`);
      const rep = await replyAI(txt, from);
      if (rep) {
        console.log(`OUT [${from}]: ${rep}`);
        await sendMsg(from, rep);
      }
      return res.json({ ok: true });
    } catch(e) {
      console.error("ERR:", e.message, e.stack);
      return res.status(500).json({ error: String(e) });
    }
  }

  return res.status(405).json({ error: "method not allowed" });
};
