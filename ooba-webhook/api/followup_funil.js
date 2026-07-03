// ═══════════════════════════════════════════════════════
// OOBA — Follow-up de funil abandonado
// POST /api/followup_funil
// Dispara para leads que pararam no meio da conversa
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
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: true } })
  });
  const d = await res.json();
  if (d?.error) { console.error("WA error:", JSON.stringify(d.error)); return false; }
  console.log("Follow-up funil enviado para", to);
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

async function montarMsg(lead, tentativa, client) {
  const negocio = lead.negocio || "seu negócio";
  const cidade = lead.cidade || "Porto Feliz";
  const vars = { negocio, cidade };

  const keyMap = {
    1: "followup_funil_1",
    2: "followup_funil_2",
    3: "followup_funil_3"
  };

  const key = keyMap[tentativa];
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

    // Lê intervalo de follow-up do banco (auto-ajustado pelo analytics)
    const intervaloRes = await client.query(
      "SELECT value FROM agent_config WHERE key='followup_intervalo_horas'"
    );
    const intervaloHoras = intervaloRes.rows.length > 0 
      ? parseInt(intervaloRes.rows[0].value) || 24 
      : 24;

    // Leads que pararam antes de ver as telas
    // Usa COALESCE para pegar também leads sem conversation record (usa created_at do lead)
    const r = await client.query(`
      SELECT l.*, COALESCE(c.updated_at, l.created_at) as ultima_msg_at
      FROM leads l
      LEFT JOIN conversations c ON c.phone = l.phone
      WHERE l.etapa_funil IN ('abertura', 'entendimento')
        AND l.etapa_funil != 'fechado'
        AND COALESCE(c.updated_at, l.created_at) < NOW() - INTERVAL '${intervaloHoras} hours'
        AND COALESCE(c.updated_at, l.created_at) > NOW() - INTERVAL '30 days'
        AND (l.data_ultima_abordagem IS NULL OR l.data_ultima_abordagem < NOW() - INTERVAL '${intervaloHoras * 2} hours')
        AND l.total_abordagens < 3
      ORDER BY ultima_msg_at ASC
      LIMIT 15
    `);

    const leads = r.rows;
    console.log(`Follow-up funil: ${leads.length} leads elegíveis (intervalo: ${intervaloHoras}h)`);

    const resultados = [];

    for (const lead of leads) {
      const tentativa = (lead.total_abordagens || 0) + 1;
      const mensagem = await montarMsg(lead, tentativa, client);
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

        resultados.push({ phone: lead.phone, tentativa, etapa: lead.etapa_funil, status: "enviado" });
        console.log(`Follow-up funil [tentativa ${tentativa}] enviado para ${lead.phone}`);
      } else {
        resultados.push({ phone: lead.phone, tentativa, etapa: lead.etapa_funil, status: "falhou" });
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    return res.json({ ok: true, total: resultados.length, intervalo_horas: intervaloHoras, resultados });

  } catch (e) {
    console.error("followup_funil error:", e.message);
    return res.status(500).json({ error: e.message });
  } finally {
    if (client) await client.end();
  }
};
