// Backend function chamado pela automação diária "Reativação por Timing"
// Chama o endpoint /api/reativar?mode=timing no webhook da OOBA na Vercel

export default async function reativacaoTiming() {
  const WEBHOOK_URL = "https://ooba-webhook.vercel.app/api/reativar?mode=timing";
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    
    const data = await response.json();
    
    let resumo = "📊 *Reativação por Timing — Relatório Diário*\n\n";
    
    if (data.success) {
      resumo += `✅ Leads reativados: ${data.enviados}\n`;
      resumo += `❌ Falhas: ${data.falhas}\n`;
      resumo += `📋 Total processados: ${data.total_processados}\n`;
      
      if (data.detalhes && data.detalhes.length > 0) {
        resumo += "\n*Leads reativados hoje:*\n";
        for (const d of data.detalhes) {
          if (d.ok) {
            resumo += `• ${d.nome || d.phone} — timing: ${d.timing}\n`;
          }
        }
      } else {
        resumo += "\nNenhum lead com timing vencido hoje. ✨\n";
      }
    } else {
      resumo += "Erro ao processar reativação. Verificar logs.\n";
    }
    
    return { success: true, resumo, data };
  } catch (error) {
    return { success: false, error: String(error), resumo: "Erro na reativação por timing: " + String(error) };
  }
}
