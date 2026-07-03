// Endpoint para registrar leads de prospecção fria via API
// POST /api/registrar_prospeccao
// Body: { secret, phone, nome, empresa, origem }
const { Client } = require("pg");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (!body || typeof body !== "object") {
    try {
      const raw = await new Promise((resolve) => {
        let d = ""; req.on("data", c => d += c); req.on("end", () => resolve(d));
      });
      body = JSON.parse(raw || "{}");
    } catch(e) { body = {}; }
  }

  const { secret, phone, nome, empresa, origem } = body;

  if (secret !== "ooba2026") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!phone) {
    return res.status(400).json({ error: "Phone is required" });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();

    // Garantir que as colunas novas existem
    await client.query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS empresa VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS ja_anunciou VARCHAR(50);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem VARCHAR(50) DEFAULT 'inbound';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS prospeccao_data TIMESTAMP;
    `).catch(() => {});

    // Upsert do lead de prospecção
    await client.query(`
      INSERT INTO leads (phone, nome, empresa, origem, status, etapa_funil, prospeccao_data, updated_at, created_at)
      VALUES ($1, $2, $3, $4, 'novo', 'abertura', NOW(), NOW(), NOW())
      ON CONFLICT (phone) DO UPDATE SET
        nome = COALESCE($2, leads.nome),
        empresa = COALESCE($3, leads.empresa),
        origem = COALESCE($4, leads.origem),
        prospeccao_data = COALESCE(leads.prospeccao_data, NOW()),
        updated_at = NOW()
    `, [phone, nome || null, empresa || null, origem || 'prospeccao']);

    console.log(`LEAD PROSPECÇÃO registrado: ${phone} | ${nome || '?'} | ${empresa || '?'}`);
    res.json({ ok: true, phone, nome, empresa, origem: origem || 'prospeccao' });
  } catch(e) {
    console.error("registrar_prospeccao:", e.message);
    res.status(500).json({ error: e.message });
  } finally {
    await client.end().catch(() => {});
  }
};
