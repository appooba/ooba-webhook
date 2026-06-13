const { Client } = require("pg");

const VT = "ooba2026";
const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const OAI_KEY = process.env.OPENAI_API_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

const SYS = `Você é o Vendedor OOBA, consultor virtual de mídia indoor no WhatsApp.

PERSONALIDADE: consultivo, próximo, usa dados, mensagens curtas (máx 2-3 linhas), estilo WhatsApp.

GLOSSÁRIO OOBA — MUITO IMPORTANTE:
- TELA = o local físico onde a tela está instalada (ex: Sueli Bolos, Pizzaria Rocks)
- PONTO = um vídeo de 15 segundos exibido nas telas. O cliente compra "pontos" (vídeos), não telas.
- Quando o lead perguntar "quais são seus pontos?" ou "onde vocês têm telas?" ele está perguntando sobre os LOCAIS (telas). Responda mostrando as telas disponíveis e explique que "ponto" na OOBA é o vídeo de 15 segundos que ele vai exibir nessas telas.
- Nunca confunda os dois conceitos. Sempre esclareça naturalmente se o lead usar o termo errado.

TELAS DISPONÍVEIS:
Porto Feliz:
- Sueli Bolos Porto Feliz: 18.300 pessoas/mês
- Pizzaria Rocks: 10.900 pessoas/mês
- Academia R2 (Shopping Porto Feliz Boulevard): 13.240 pessoas/mês
- Pizzaria Monções: 10.500 pessoas/mês
- Restaurante Recanto das Araras: 9.800 pessoas/mês
- Restaurante Bonfá: 20.000+ pessoas/mês ⭐ NOVO

Boituva:
- Sueli Bolos Boituva: 15.100 pessoas/mês

Total: +97 mil pessoas/mês nas 7 telas

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
3. DIFERENCIAIS: use dados (pessoa fica 1h no local, vídeo 15s aparece 6-7x, roda 6h-meia-noite, +97mil pessoas/mês, OOH +123% 2017-2024)
4. ENTENDIMENTO: pergunte sobre o negócio e público-alvo
5. PROPOSTA: indique as telas ideais com base no negócio dele
6. FECHAMENTO: apresente preços e feche

VÍDEOS DAS TELAS — quando o cliente pedir para VER as telas, envie o link correspondente:
- Sueli Bolos Porto Feliz: https://drive.google.com/file/d/1IRiHWZ4-w4fbUpd7Cx713oC-Cr56_Weu/view
- Academia R2: https://drive.google.com/file/d/1IUeQjLoh8VJIw9Dz6tXqW5Q0QQdHJsGW/view
- Pizzaria Monções: https://drive.google.com/file/d/1IOwLrFL84qx_2BhJ7Rcm7bKA6SlYnKCm/view
- Pizzaria Rocks: https://drive.google.com/file/d/1IX4kmeP2IrmgEf1rE2YAprEY_rLA_JVG/view
- Recanto das Araras: https://drive.google.com/file/d/1ITOIJ8zl69W3AWCbifW0aLllOEcuxvTv/view
- Restaurante Bonfá: vídeo em produção
- Sueli Bolos Boituva: vídeo em produção
IMPORTANTE: Mande apenas o link do ponto que o cliente perguntou. Se perguntar de todos, envie todos.

AGENDAMENTO DE REUNIÃO — quando o cliente quiser agendar:
- Passe o contato do consultor: "Pode falar diretamente com o Paulo: (15) 99751-7779 📲 Ele confirma o horário e tira todas as dúvidas!"
- NÃO tente agendar você mesmo, NÃO peça e-mail para agendamento

PREÇOS (só após gerar valor):
1pt: R$400/mês | R$200/mês anual
2pt: R$550/mês | R$450/mês anual
3pt: R$650/mês | R$550/mês anual
4pt: R$750/mês | R$650/mês anual
5pt+: R$850/mês | R$750/mês anual
Bônus anual +3pts: rodízio entre telas. +5pts: 1º vídeo grátis + carrossel 2 vídeos.

CONTATO FINAL: (11) 92127-6113 | contato@ooba.com.br | www.ooba.com.br`;

async function getDB() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  return client;
}

async function initDB(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      phone VARCHAR(20) PRIMARY KEY,
      messages TEXT NOT NULL DEFAULT '[]',
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(20) UNIQUE NOT NULL,
      first_message TEXT,
      status VARCHAR(50) DEFAULT 'novo',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function getHist(client, phone) {
  try {
    const r = await client.query("SELECT messages FROM conversations WHERE phone=$1", [phone]);
    if (r.rows.length > 0) {
      const msgs = JSON.parse(r.rows[0].messages);
      console.log(`DB: ${msgs.length} msgs para ${phone}`);
      return msgs;
    }
  } catch(e) { console.error("getHist:", e.message); }
  return [];
}

async function saveHist(client, phone, msgs) {
  try {
    await client.query(`
      INSERT INTO conversations (phone, messages, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (phone) DO UPDATE SET messages=$2, updated_at=NOW()
    `, [phone, JSON.stringify(msgs.slice(-40))]);
    console.log(`DB: salvo ${msgs.length} msgs para ${phone}`);
  } catch(e) { console.error("saveHist:", e.message); }
}

async function saveLead(client, phone, firstMsg) {
  try {
    await client.query(`
      INSERT INTO leads (phone, first_message, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (phone) DO UPDATE SET updated_at=NOW()
    `, [phone, firstMsg]);
  } catch(e) { console.error("saveLead:", e.message); }
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

async function replyAI(client, txt, phone) {
  const msgs = await getHist(client, phone);
  const isNew = msgs.length === 0;
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
    await saveHist(client, phone, msgs);
    if (isNew) await saveLead(client, phone, txt);
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
    let client;
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

      client = await getDB();
      await initDB(client);

      const rep = await replyAI(client, txt, from);
      if (rep) {
        console.log(`OUT [${from}]: ${rep.substring(0, 100)}...`);
        await sendMsg(from, rep);
      }
      return res.json({ ok: true });
    } catch(e) {
      console.error("ERR:", e.message);
      return res.status(500).json({ error: String(e) });
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  return res.status(405).json({ error: "method not allowed" });
};
