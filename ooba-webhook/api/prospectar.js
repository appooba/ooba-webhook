export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  
  const { secret, leads } = req.body;
  if (secret !== "ooba2026") return res.status(403).json({ error: "Unauthorized" });
  if (!leads || !Array.isArray(leads)) return res.status(400).json({ error: "leads array required" });
  
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { require: true } });
  
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const PHONE_NUMBER_ID = "1189704930882063";
  const TEMPLATE_NAME = "ooba_apresentacao_botao";
  const TEMPLATE_LANG = "pt_BR";
  
  const results = [];
  
  for (const lead of leads) {
    const phone = lead.phone.replace(/\D/g, "");
    const nome = lead.nome || "";
    
    try {
      const client = await pool.connect();
      const existing = await client.query("SELECT phone FROM leads WHERE phone = $1", [phone]);
      
      if (existing.rows.length > 0) {
        results.push({ phone, nome, status: "ja_existe" });
        client.release();
        continue;
      }
      
      await client.query(
        "INSERT INTO leads (phone, nome, first_message, etapa_funil, status, origem, prospeccao_data, updated_at) VALUES ($1, $2, $3, 'abertura', 'novo', 'prospeccao', NOW(), NOW())",
        [phone, nome, "Prospecção automática: " + nome]
      );
      client.release();
      
      const response = await fetch("https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/messages", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + WHATSAPP_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: TEMPLATE_NAME,
            language: { code: TEMPLATE_LANG },
            components: [{
              type: "body",
              parameters: [{ type: "text", text: nome || "amigo(a)" }]
            }, {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: "5b2eabf2a_5aad73535_ApresentaoOOBAMidiaIndoor" }]
            }]
          }
        })
      });
      
      const data = await response.json();
      
      if (data.messages && data.messages[0]) {
        results.push({ phone, nome, status: "enviado", message_id: data.messages[0].id });
      } else {
        results.push({ phone, nome, status: "erro_whatsapp", error: JSON.stringify(data.error || data) });
      }
      
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      results.push({ phone, nome, status: "erro", error: err.message });
    }
  }
  
  const enviados = results.filter(r => r.status === "enviado").length;
  const erros = results.filter(r => r.status.startsWith("erro")).length;
  const duplicados = results.filter(r => r.status === "ja_existe").length;
  
  res.status(200).json({ total: leads.length, enviados, erros, duplicados, results });
}
