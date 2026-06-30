// ═══════════════════════════════════════════════════════
// OOBA — Follow-up automático de leads quentes
// POST /api/followup
// Dispara para leads que receberam material e sumiram há 20-48h
// ═══════════════════════════════════════════════════════

const { Client } = require("pg");

const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const DATABASE_URL = process.env.DATABASE_URL || "";
const OAI_KEY = process.env.OPENAI_API_KEY || "";

async function getDB() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function sendMsg(to, body) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } })
  });
  const d = await res.json();
  if (d?.error) { console.error("WA error:", JSON.stringify(d.error)); return false; }
  console.log("Follow-up enviado para", to);
  return true;
}

function montarFollowup(lead, tipo) {
  const nome = lead.nome ? lead.nome.split(" ")[0] : null;
  const oi = nome ? `Oi ${nome}!` : `Oi!`;
  const negocio = lead.negocio || "seu negócio";
  const telas = lead.telas_interesse || "as telas que conversamos";

  if (tipo === "apos_material") {
    return `${oi} 😊 Tudo bem?

Mandei a apresentação da OOBA ontem — conseguiu dar uma olhada nos valores?

Fico feliz em tirar qualquer dúvida aqui mesmo, ou posso agendar 15 min com o Paulo pra ele montar uma proposta personalizada pra ${negocio}. Qual prefere? 😊`;
  }

  if (tipo === "apos_videos") {
    return `${oi} 😊

Vi que te mandei os vídeos das telas — o que achou? Alguma chamou mais atenção?

Com base no seu perfil, eu recomendaria começar por ${telas}. Posso te mandar a apresentação completa com os valores? É rapidinho 📊`;
  }

  if (tipo === "apos_proposta") {
    return `${oi}! 😊

Só passando pra saber se ficou alguma dúvida sobre os valores que te apresentei.

Se o investimento pareceu alto, posso te mostrar uma opção menor pra começar — 1 ponto já coloca sua marca na frente de milhares de pessoas por mês 💡

O que achou?`;
  }

  if (tipo === "recuperar_conversa") {
    return `${oi}! Sou a Luana da OOBA 😊

A gente conversou sobre divulgar ${negocio} nas nossas telas — ficou alguma dúvida que eu possa tirar?

Posso marcar 15 min com o Paulo essa semana, sem compromisso, pra ele te mostrar as opções. O que acha?`;
  }

  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = req.query.secret || req.body?.secret;
  if (secret !== "ooba2026") return res.status(403).json({ error: "Forbidden" });

  let client;
  try {
    client = await getDB();

    // Buscar leads que receberam material mas não responderam em 20-48h
    // Etapas: materiais, proposta, recomendacao — sem atualização recente
    const r = await client.query(`
      SELECT l.*, c.updated_at as ultima_msg_at
      FROM leads l
      LEFT JOIN conversations c ON c.phone = l.phone
      WHERE l.etapa_funil IN ('materiais', 'proposta', 'recomendacao', 'apresentacao', 'fechamento')
        AND l.etapa_funil != 'fechado'
        AND l.etapa_funil != 'reuniao'
        AND c.updated_at < NOW() - INTERVAL '20 hours'
        AND c.updated_at > NOW() - INTERVAL '30 days'
        AND (l.data_ultima_abordagem IS NULL OR l.data_ultima_abordagem < NOW() - INTERVAL '48 hours')
        AND l.total_abordagens < 3
      ORDER BY c.updated_at DESC
      LIMIT 15
    `);

    const leads = r.rows;
    console.log(`Follow-up: ${leads.length} leads elegíveis`);

    const resultados = [];

    for (const lead of leads) {
      // Determinar tipo de follow-up pela etapa
      let tipo = "recuperar_conversa";
      if (lead.etapa_funil === "materiais" || lead.etapa_funil === "proposta") tipo = "apos_material";
      else if (lead.etapa_funil === "recomendacao") tipo = "apos_videos";
      else if (lead.etapa_funil === "fechamento") tipo = "apos_proposta";

      const mensagem = montarFollowup(lead, tipo);
      if (!mensagem) continue;

      const ok = await sendMsg(lead.phone, mensagem);

      if (ok) {
        // Registrar abordagem
        await client.query(`
          UPDATE leads 
          SET data_ultima_abordagem = NOW(),
              total_abordagens = total_abordagens + 1,
              updated_at = NOW()
          WHERE phone = $1
        `, [lead.phone]);

        // Salvar no histórico de conversa para manter contexto
        const convR = await client.query("SELECT messages FROM conversations WHERE phone=$1", [lead.phone]);
        if (convR.rows.length > 0) {
          const msgsRaw = convR.rows[0].messages;
          const msgs = typeof msgsRaw === 'string' ? JSON.parse(msgsRaw || '[]') : (msgsRaw || []);
          msgs.push({ role: "assistant", content: mensagem });
          await client.query("UPDATE conversations SET messages=$1, updated_at=NOW() WHERE phone=$2", 
            [JSON.stringify(msgs), lead.phone]);
        }

        resultados.push({ phone: lead.phone, tipo, etapa: lead.etapa_funil, status: "enviado" });
        console.log(`Follow-up [${tipo}] enviado para ${lead.phone} (etapa: ${lead.etapa_funil})`);
      } else {
        resultados.push({ phone: lead.phone, tipo, etapa: lead.etapa_funil, status: "falhou" });
      }

      // Delay entre envios para não parecer spam
      await new Promise(r => setTimeout(r, 2000));
    }

    return res.json({ ok: true, total: resultados.length, resultados });

  } catch (e) {
    console.error("followup error:", e.message);
    return res.status(500).json({ error: e.message });
  } finally {
    if (client) await client.end();
  }
};
