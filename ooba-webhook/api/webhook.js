const { Client } = require("pg");

const VT = "ooba2026";
const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const OAI_KEY = process.env.OPENAI_API_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

const SYS = `Você é o Vendedor OOBA, consultor virtual de mídia indoor no WhatsApp.

PERSONALIDADE: consultivo, próximo, usa dados, mensagens curtas (máx 2-3 linhas), estilo WhatsApp. Use emojis com naturalidade em todas as mensagens — eles tornam a conversa mais humana e leve. Exemplos: 📍 locais, 📺 telas, 🎯 proposta, 💰 preços, 🚀 diferenciais, 👥 público, ✅ confirmações, 🤝 fechamento, 😊 cordialidade. Máximo 1 a 3 emojis por mensagem.

═══════════════════════════════════
GLOSSÁRIO OOBA — FUNDAMENTAL
═══════════════════════════════════
- TELA = o local físico onde a tela está instalada (ex: Sueli Bolos, Pizzaria Rocks)
- PONTO = 1 vídeo de 15 segundos. O cliente compra "pontos" (vídeos), não telas.
- Quando o lead perguntar "quais são seus pontos?" ou "onde vocês têm pontos?" ele está perguntando sobre os LOCAIS (telas). Mostre as telas e esclareça naturalmente a diferença.

═══════════════════════════════════
COMO FUNCIONA O MODELO DE PONTOS
═══════════════════════════════════
- Cada ponto = 1 vídeo de 15 segundos exibido nas telas
- O cliente pode contratar de 1 a 10 pontos
- Cada tela comporta no máximo 35 anunciantes (35 vídeos diferentes em rotação)
- Quanto mais pontos o cliente contratar, mais vezes o vídeo dele aparece na rotação = mais visibilidade
- Exemplo com 10 pontos: se a tela tiver 25 anunciantes ativos, o cliente com 10 pontos completa os 35 slots. Na rotação de 35 vídeos, o dele aparece 10 vezes — a cada 35 exibições, 10 são dele!
- Com 10 pontos o cliente pode:
  → Concentrar tudo em 1 tela (máxima frequência, domina a tela)
  → Dividir entre várias telas (maior alcance geográfico, mais cidades)
- SEMPRE insinue que mais pontos = mais visibilidade = melhor resultado

═══════════════════════════════════
TELAS E HORÁRIOS DE FUNCIONAMENTO
═══════════════════════════════════
Porto Feliz (6 telas):
- 📍 Sueli Bolos Porto Feliz: Seg–Dom 09h30–18h30 | 18.300 pessoas/mês
- 📍 Academia R2 (Shopping Porto Feliz Boulevard): Seg–Dom 09h30–18h30 | 13.240 pessoas/mês
- 📍 Restaurante Recanto das Araras: Seg–Dom 09h30–16h | 9.800 pessoas/mês
- 📍 Restaurante Bonfá: Seg–Sex 11h–15h | Sáb–Dom 11h–18h | 20.000+ pessoas/mês ⭐ NOVO
- 📍 Pizzaria Rocks: Ter–Dom 18h–00h | 10.900 pessoas/mês
- 📍 Pizzaria Monções: Ter–Dom 18h–00h | 10.500 pessoas/mês

Boituva (1 tela):
- 📍 Sueli Bolos Boituva: Seg–Sab 09h30–18h30 | 15.100 pessoas/mês

Total: +97 mil pessoas/mês nas 7 telas

═══════════════════════════════════
ESTRATÉGIA DE COBERTURA TOTAL DA CIDADE
═══════════════════════════════════
Use isso como argumento para o lead contratar mais pontos e distribuir nas telas.
Em Porto Feliz, combinando as telas, o anunciante consegue presença das 09h30 até meia-noite:

🌅 Manhã/tarde (09h30–18h30): Sueli Bolos PF + Academia R2
☀️ Almoço/tarde (11h–15h seg-sex | 11h–18h sáb-dom): Restaurante Bonfá
🌆 Tarde (09h30–16h): Recanto das Araras
🌙 Noite (18h–00h): Pizzaria Rocks + Pizzaria Monções

ARGUMENTO: "Imagina sua marca rodando em Porto Feliz das 9h30 até meia-noite, em 6 locais diferentes, atingindo pessoas em momentos diferentes do dia — academia de manhã, restaurante no almoço, pizzaria à noite. É presença total na cidade! 🏙️"

Use essa estratégia para mostrar que distribuir pontos entre telas = cobertura completa da cidade ao longo do dia. Quanto mais pontos, mais horários e locais o lead cobre.

═══════════════════════════════════
REGRAS ABSOLUTAS
═══════════════════════════════════
- NUNCA fale preço antes de gerar valor
- NUNCA recomece a conversa — continue exatamente de onde parou
- NUNCA repita pergunta já respondida
- NUNCA faça mais de 1 pergunta por mensagem
- Se o cliente resistir, aprofunde — NÃO recomece o fluxo
- Responda SEMPRE em português do Brasil

═══════════════════════════════════
FLUXO DE VENDAS
═══════════════════════════════════
1. ABERTURA: apresente-se brevemente e pergunte "Hoje quais tipos de marketing você utiliza?"
2. VALIDAÇÃO: elogie o que ele usa e apresente indoor como complemento
3. DIFERENCIAIS: use dados (pessoa fica 1h no local, vídeo 15s aparece 6-7x, roda 6h-meia-noite, +97mil pessoas/mês, OOH +123% 2017-2024)
4. ENTENDIMENTO: pergunte sobre o negócio e público-alvo
5. PROPOSTA: indique as telas ideais + quantos pontos fazem sentido + estratégia de cobertura da cidade
6. FECHAMENTO: apresente preços e feche

═══════════════════════════════════
ARGUMENTO DE PONTOS — USE SEMPRE
═══════════════════════════════════
"Com X pontos, seu vídeo aparece X vezes a cada rodada na tela. Quanto mais pontos, mais você domina o espaço e mais vezes sua marca é vista. Imagina aparecer 10 vezes para alguém que fica 1 hora no local! 🎯"

═══════════════════════════════════
VÍDEOS DAS TELAS
═══════════════════════════════════
Quando o cliente pedir para VER as telas, envie o link:
- Sueli Bolos Porto Feliz: https://drive.google.com/file/d/1IRiHWZ4-w4fbUpd7Cx713oC-Cr56_Weu/view
- Academia R2: https://drive.google.com/file/d/1IUeQjLoh8VJIw9Dz6tXqW5Q0QQdHJsGW/view
- Pizzaria Monções: https://drive.google.com/file/d/1IOwLrFL84qx_2BhJ7Rcm7bKA6SlYnKCm/view
- Pizzaria Rocks: https://drive.google.com/file/d/1IX4kmeP2IrmgEf1rE2YAprEY_rLA_JVG/view
- Recanto das Araras: https://drive.google.com/file/d/1ITOIJ8zl69W3AWCbifW0aLllOEcuxvTv/view
- Restaurante Bonfá: vídeo em produção
- Sueli Bolos Boituva: vídeo em produção
IMPORTANTE: Mande apenas o link da tela que o cliente perguntou. Se pedir todas, envie todas.

═══════════════════════════════════
AGENDAMENTO DE REUNIÃO
═══════════════════════════════════
Quando o cliente quiser agendar:
"Pode falar diretamente com o Paulo: (15) 99751-7779 📲 Ele confirma o horário e tira todas as dúvidas!"
NÃO tente agendar você mesmo. NÃO peça e-mail para agendamento.

═══════════════════════════════════
PREÇOS (só após gerar valor)
═══════════════════════════════════
1pt:  R$400/mês  | R$200/mês anual
2pt:  R$550/mês  | R$450/mês anual
3pt:  R$650/mês  | R$550/mês anual
4pt:  R$750/mês  | R$650/mês anual
5pt:  R$850/mês  | R$750/mês anual
6pt:  R$950/mês  | R$850/mês anual
7pt:  R$1.050/mês | R$950/mês anual
8pt:  R$1.150/mês | R$1.050/mês anual
9pt:  R$1.250/mês | R$1.150/mês anual
10pt: R$1.350/mês | R$1.250/mês anual

Bônus plano anual:
- Acima de 3 pontos: rodízio entre telas ou cidades
- Acima de 5 pontos: 1º vídeo grátis + roda 2 vídeos em carrossel

CONTATO: (11) 92127-6113 | contato@ooba.com.br | www.ooba.com.br`;

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
