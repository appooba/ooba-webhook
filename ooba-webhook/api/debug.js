// Endpoint temporário de diagnóstico — REMOVER APÓS USO
const { Client } = require("pg");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  
  const secret = req.query.secret;
  if (secret !== "ooba2026debug") return res.status(403).json({ error: "forbidden" });

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    await client.connect();
    
    // Últimas conversas
    const convRes = await client.query(
      "SELECT phone, COALESCE(json_array_length(messages::json), 0) as total_msgs, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 10"
    );
    
    // Últimos leads
    const leadsRes = await client.query(
      "SELECT * FROM leads ORDER BY created_at DESC LIMIT 5"
    );

    res.json({
      ok: true,
      conversations: convRes.rows,
      leads: leadsRes.rows,
      env_check: {
        has_wat: !!process.env.WHATSAPP_TOKEN,
        wat_length: (process.env.WHATSAPP_TOKEN || "").length,
        has_oai: !!process.env.OPENAI_API_KEY,
        has_db: !!process.env.DATABASE_URL
      }
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  } finally {
    await client.end().catch(() => {});
  }
};
