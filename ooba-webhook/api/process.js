// Endpoint interno para processar mensagens de forma assíncrona
// Chamado pelo webhook.js após responder ao Meta
module.exports = async (req, res) => {
  res.json({ ok: true }); // resposta imediata para o caller interno
  // O processamento real está no webhook.js via setImmediate
};
