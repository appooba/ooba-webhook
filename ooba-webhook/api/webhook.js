const VT = "ooba2026";
const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const OAI_KEY = process.env.OPENAI_API_KEY || "";
const BASE44_API_KEY = process.env.BASE44_API_KEY || "";
const BASE44_APP_ID = "69f645345c37a4db77e0e07d";

const SYS = `Voce e OOBA, vendedor virtual da OOBA Midia Indoor no WhatsApp.
REGRAS: use emojis, NUNCA fale preco primeiro, mensagens curtas max 3 linhas estilo WhatsApp, NUNCA reinicie a conversa - continue de onde parou, se cliente ja disse que usa radio/facebook/outdoor nao pergunte de novo avance, se resistir aprofunde nao recomece, responda em portugues do Brasil.
PRIMEIRA MENSAGEM: apresente-se e pergunte qual marketing usa hoje.
FLUXO: 1 apresentacao mais pergunta marketing 2 valide mais indoor como complemento 3 diferenciais com dados 4 pergunte sobre negocio 5 proposta e precos 6 fechamento.
DADOS: 1h no local, video 15s aparece 6-7x, roda 6h meia-noite, OOH mais 123% 2017-2024, mais 70mil pessoas por mes.
OUTDOOR vs INDOOR: outdoor alcance rapido, indoor fixacao e repeticao, pessoa parada presta mais atencao.
PONTOS: Sueli PF 18300 por mes, Academia R2 13240 por mes, Moncoes 10500 por mes, Rocks 10900 por mes, Araras 9800 por mes, Sueli Boituva 15100 por mes.
PRECOS somente apos gerar valor: 1pt R400 mes R200 anual, 2pt R550 R450, 3pt R650 R550, 4pt R750 R650, 5pt mais R850.
BONUS ANUAL: mais 3pts rodizio, mais 5pts 1video gratis mais carrossel.
CONTATO FINAL: 11 92127-6113, contato@ooba.com.br, www.ooba.com.br.`;

const BASE_URL = `https://base44.app/api/apps/${BASE44_APP_ID}`;

async function getHist(phone) {
  try {
    const res = await fetch(`${BASE_URL}/entities/ConversationHistory/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": BASE44_API_KEY },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (data?.length > 0) {
      const msgs = JSON.parse(data[0].messages || "[]");
      return { id: data[0].id, msgs };
    }
  } catch(e) { console.error("getHist:", e.message); }
  return { id: undefined, msgs: [] };
}

async function saveHist(phone, id, msgs) {
  try {
    const payload = { phone, messages: JSON.stringify(msgs.slice(-20)) };
    if (id) {
      await fetch(`${BASE_URL}/entities/ConversationHistory/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-api-key": BASE44_API_KEY },
        body: JSON.stringify(payload)
      });
    } else {
      await fetch(`${BASE_URL}/entities/ConversationHistory`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": BASE44_API_KEY },
        body: JSON.stringify(payload)
      });
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
  console.log("WA:", d?.messages?.[0]?.id || JSON.stringify(d));
}

async function replyAI(txt, phone) {
  const { id, msgs } = await getHist(phone);
  msgs.push({ role: "user", content: txt });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: SYS }, ...msgs], max_tokens: 350, temperature: 0.7 })
  });
  const d = await res.json();
  const rep = d?.choices?.[0]?.message?.content?.trim() || "";
  if (rep) { msgs.push({ role: "assistant", content: rep }); await saveHist(phone, id, msgs); }
  return rep;
}

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
      const from = m.from, txt = m?.text?.body?.trim() || "";
      if (!from || !txt) return res.json({ ok: true });
      console.log(`IN ${from}: ${txt}`);
      const rep = await replyAI(txt, from);
      if (rep) await sendMsg(from, rep);
      return res.json({ ok: true });
    } catch(e) {
      console.error("ERR:", e);
      return res.status(500).json({ error: String(e) });
    }
  }
  return res.status(405).json({ error: "method not allowed" });
};
