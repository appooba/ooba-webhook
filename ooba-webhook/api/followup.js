// ═══════════════════════════════════════════════════════
// OOBA — Follow-up automático de leads quentes
// POST /api/followup
// Textos lidos do banco (agent_config) — sem hardcoded
// ═══════════════════════════════════════════════════════

const { Client } = require("pg");
const { getConfig } = require("./db_config");

const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const DATABASE_URL = process.env.DATABASE_URL || "";

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

function aplicarVars(texto, vars) {
  if (!texto) return null;
  let out = texto;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

async function montarFollowup(lead, tipo, client) {
  const nome = lead.nome ? lead.nome.split(" ")[0] : null;
  const oi = nome ? `Oi ${nome}!` : `Oi!`;
  const negocio = lead.negocio || "seu negócio";
  const telas = lead.telas_interesse || "as telas que conversamos";
  const vars = { oi, negocio, telas };

  const keyMap = {
    "apos_material": "followup_apos_material",
    "apos_videos": "followup_apos_videos",
    "apos_proposta": "followup_apos_proposta",
    "recuperar_conversa": "followup_recuperar_conversa"
  };

  const key = keyMap[tipo];
  if (!key) return null;

  const template = await getConfig(client, key);
  if (!template) {
    console.error(`Texto ${key} nao encontrado no agent_config`);
    return null;
  }

  return aplicarVars(template, vars);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = req.query.secret || req.body?.secret;
  if (secret !== "ooba2026") return res.status(403).json({ error: "Forbidden" });

  let client;
  try {
    client = await getDB();

    const r = await client.query(`
      SELECT l.*, COALESCE(c.updated_at, l.created_at) as ultima_msg_at
      FROM leads l
      LEFT JOIN conversations c ON c.phone = l.phone
      WHERE l.etapa_funil IN ('materiais', 'proposta', 'recomendacao', 'apresentacao', 'fechamento')
        AND l.etapa_funil != 'fechado'
        AND l.etapa_funil != 'reuniao'
        AND COALESCE(c.updated_at, l.created_at) < NOW() - INTERVAL '20 hours'
        AND COALESCE(c.updated_at, l.created_at) > NOW() - INTERVAL '30 days'
        AND (l.data_ultima_abordagem IS NULL OR l.data_ultima_abordagem < NOW() - INTERVAL '48 hours')
        AND l.total_abordagens < 3
      ORDER BY ultima_msg_at DESC
      LIMIT 15
    `);

    const leads = r.rows;
    console.log(`Follow-up: ${leads.length} leads elegiveis`);

    const resultados = [];

    for (const lead of leads) {
      let tipo = "recuperar_conversa";
      if (lead.etapa_funil === "materiais" || lead.etapa_funil === "proposta") tipo = "apos_material";
      else if (lead.etapa_funil === "recomendacao") tipo = "apos_videos";
      else if (lead.etapa_funil === "fechamento") tipo = "apos_proposta";

      const mensagem = await montarFollowup(lead, tipo, client);
      if (!mensagem) continue;

      const ok = await sendMsg(lead.phone, mensagem);

      if (ok) {
        await client.query(`
          UPDATE leads 
          SET data_ultima_abordagem = NOW(),
              total_abordagens = total_abordagens + 1,
              updated_at = NOW()
          WHERE phone = $1
        `, [lead.phone]);

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
