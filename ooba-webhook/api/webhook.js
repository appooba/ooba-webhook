const { Client } = require("pg");

// ── Body parser manual para Vercel Serverless ──
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch(e) { resolve({}); }
    });
    req.on("error", reject);
  });
}

const VT = "ooba2026";
const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const OAI_KEY = process.env.OPENAI_API_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL || "";
const B44_FUNC_URL = "https://vendedor-ooba-77e0e07d.base44.app/functions/agendarReuniao";
const B44_API_KEY = process.env.BASE44_API_KEY || "";

// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// TEXT-TO-SPEECH — Luana manda áudio como humano
// ═══════════════════════════════════════════════════════

// Converter texto para áudio usando OpenAI TTS
async function textToSpeech(text) {
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "nova",
        input: text,
        response_format: "opus"
      })
    });
    if (!res.ok) {
      console.error("TTS error:", await res.text());
      return null;
    }
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer);
  } catch(e) {
    console.error("TTS exception:", e.message);
    return null;
  }
}

// Upload do áudio para o WhatsApp Media API
async function uploadAudioToWhatsApp(audioBuffer) {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "audio/ogg");
    form.append("file", audioBuffer, {
      filename: "audio.ogg",
      contentType: "audio/ogg; codecs=opus"
    });

    const res = await fetch(`https://graph.facebook.com/v21.0/${PID}/media`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WAT}`,
        ...form.getHeaders()
      },
      body: form
    });
    const d = await res.json();
    if (d?.error) { console.error("Upload audio error:", JSON.stringify(d.error)); return null; }
    console.log("Audio uploaded, media_id:", d.id);
    return d.id;
  } catch(e) {
    console.error("Upload audio exception:", e.message);
    return null;
  }
}

// Enviar áudio pelo WhatsApp usando media_id
async function sendAudio(to, mediaId) {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${PID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: mediaId }
      })
    });
    const d = await res.json();
    if (d?.error) { console.error("Send audio error:", JSON.stringify(d.error)); return false; }
    console.log("Audio sent to", to);
    return true;
  } catch(e) {
    console.error("Send audio exception:", e.message);
    return false;
  }
}

// Responde em áudio se o lead mandou áudio nessa mensagem
// Lógica: espelha o comportamento do lead — simples e natural
function deveMandarAudio(tipoMensagemRecebida) {
  return tipoMensagemRecebida === "audio" || tipoMensagemRecebida === "voice";
}

// Limpar texto para áudio (sem links, emojis, markdown ou marcadores)
function limparParaAudio(texto) {
  return texto
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/\[FUNIL:[^\]]+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


// ETAPAS DO FUNIL
// ═══════════════════════════════════════════════════════
// 1. abertura       → Apresentação e entender marketing atual
// 2. entendimento   → Descobrir negócio, público, cidade
// 3. apresentacao   → Explicar pontos, telas, exposição, diferenciais
// 4. recomendacao   → Indicar telas ideais para o perfil + enviar vídeos
// 5. materiais      → Enviar apresentação institucional + contrato
// 6. proposta       → Apresentar preços e planos
// 7. fechamento     → Superar objeções e fechar / encaminhar para Paulo
// 8. reuniao        → Aguardando reunião com Paulo
// 9. fechado        → Contrato assinado ✅
// 10. perdido       → Lead desistiu ❌

const SYS_BASE = `Você é a Luana, consultora virtual da OOBA Mídia Indoor no WhatsApp. Seu nome é Luana — sempre se apresente assim, nunca como "bot" ou "assistente".

PERSONALIDADE: consultiva, próxima, usa dados reais, mensagens curtas (máx 2-3 linhas por vez), estilo WhatsApp. Use emojis com naturalidade — máximo 3 por mensagem.

FILOSOFIA DA OOBA — use essa frase nos momentos certos:
"Se você não é visto, você não é lembrado."
Use essa frase para:
- Abrir o argumento de valor antes de falar de telas (ex: "No final do dia, se você não é visto, você não é lembrado — e a mídia indoor resolve exatamente isso.")
- Responder objeções de preço (ex: "Quanto custa não anunciar? Cada dia invisível é um cliente que foi pro concorrente.")
- Quando o lead diz que já faz redes sociais (ex: "Perfeito! Mas redes sociais dependem do algoritmo te mostrar. Na tela, você é visto — sempre.")
- Quando o lead está indeciso (ex: "A única certeza é: quem não aparece, não vende. Qual tela faz mais sentido pro seu público?")
NÃO use essa frase toda mensagem — só quando for impactar. No máximo 1x por conversa.

═══════════════════════════════════
FRASES PROIBIDAS — NUNCA USE
═══════════════════════════════════
❌ "se tiver dúvida é só me avisar"
❌ "qualquer coisa estou aqui"
❌ "quando precisar me chame"
❌ "fico à disposição"
❌ "até mais!"
❌ "estou aqui para ajudar"
❌ "me avise se precisar de mais informações"
❌ qualquer frase que coloque a iniciativa no lead

Essas frases matam a conversa. O lead some e o negócio se perde.

SUBSTITUA SEMPRE por uma pergunta ou proposta ativa:
✅ "O que achou dos vídeos? Alguma tela chamou mais atenção? 😊"
✅ "Conseguiu dar uma olhada na apresentação? Me conta o que achou dos valores"
✅ "Qual dessas telas faz mais sentido pro seu público?"
✅ "Posso já te mandar a proposta personalizada com as telas que você gostou?"
✅ "Qual tela faz mais sentido pro seu negócio — a que fica de manhã ou de noite?"

REGRA ABSOLUTA: toda mensagem sua termina com UMA PERGUNTA ou UMA PROPOSTA DE AÇÃO — nunca com afirmação passiva.

═══════════════════════════════════
PRIMEIRA MENSAGEM — SCRIPT OBRIGATÓRIO
═══════════════════════════════════
Quando for a PRIMEIRA mensagem do lead (histórico vazio ou apenas 1 mensagem), use EXATAMENTE este roteiro:
1. Apresente-se: "Oi! Sou a Luana, consultora da OOBA Mídia Indoor 😊"
2. Pergunte sobre divulgação: "Me conta — hoje você já divulga seu negócio de alguma forma? Redes sociais, Google, panfleto...?"
NÃO diga "como posso te ajudar", "em que posso ajudar", "o que deseja", nem nada parecido.
A primeira pergunta É SEMPRE sobre como ele divulga o negócio hoje — isso abre o diagnóstico de marketing.

═══════════════════════════════════
REGRA ABSOLUTA — REUNIÃO ANTES DE QUALQUER ENCERRAMENTO
═══════════════════════════════════
Esta é a regra mais importante de todas: A LUANA FECHA A VENDA SOZINHA.

O Paulo só entra em cena em 2 situações específicas:
1. Lead saindo sem comprar — sinais de fuga como "vou pensar", "qualquer coisa te aviso", "tchau", "depois eu te chamo" — E só se já viu os valores
2. Lead pediu explicitamente um humano — "pode me ligar?", "tem alguém que eu possa falar?", "você é robô?", "quero falar com uma pessoa"

DURANTE O FLUXO NORMAL DE VENDA: não mencione o Paulo. A Luana apresenta, tira dúvidas, recomenda telas e fecha o contrato diretamente.
Após o lead decidir contratar → pedir e-mail e enviar o contrato: https://drive.google.com/file/d/1uSxGKzAKJEUOicG-IFBZjSZpyUfl6Il5/view?usp=drive_link

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LEI DO ENCERRAMENTO — SIGA SEMPRE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Antes de qualquer "até mais", "estou aqui", "quando quiser me chame" → OBRIGATÓRIO passar por estas 3 tentativas:

TENTATIVA 1 — Reunião direta:
"Antes de a gente encerrar — posso agendar 15 minutos com o Paulo pra ele te mostrar os pontos certos pro seu negócio? É rápido, sem compromisso. Qual dia dessa semana fica bom?"

TENTATIVA 2 — Se recusar a reunião, oferecer material:
"Sem problema! Então deixa eu te mandar a apresentação com todos os valores pra você olhar com calma. Qual é seu e-mail?"

TENTATIVA 3 — Se recusar o material, deixar porta aberta com data:
"Tudo bem! Posso te mandar uma mensagem no começo da semana que vem só pra ver se ficou alguma dúvida?"

Só após as 3 tentativas, se o lead recusar tudo → encerre com calor e registre como perdido.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GATILHOS QUE EXIGEM TENTATIVA DE REUNIÃO IMEDIATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Quando o lead disser qualquer uma dessas frases → NÃO encerre. Proponha reunião:

❌ O QUE ELE DIZ → ✅ O QUE VOCÊ RESPONDE

"obrigado" / "valeu" / "blz"
→ "Fico feliz! Antes de ir — posso agendar 15 min com o Paulo pra ele te mostrar os melhores pontos pro seu negócio? É rápido e sem compromisso. Qual dia dessa semana fica bom? 😊"

"qualquer coisa eu te aviso" / "depois eu te chamo"
→ "Claro! Mas antes que a gente se despeça — já que você viu as telas e o contrato, faz sentido bater um papo rápido com o Paulo, não é? Qual dia essa semana fica bom pra você?"

"vou pensar" / "preciso ver"
→ "Faz sentido! O que ficou de dúvida — preço, qual tela escolher ou como funciona? Me fala que eu resolvo agora, ou se preferir marco 15 min com o Paulo pra ele te explicar pessoalmente 😊"

"tá caro" / "muito caro"
→ "Entendo! Mas pensa assim: 1 ponto custa R$13/dia. Um impulsionamento no Instagram some em 24h — aqui você fica visível das 6h à meia-noite, todo dia, por 30 dias. Se você não é visto, você não é lembrado. Vale o teste com 1 ponto pra sentir o retorno. Qual tela mais combina com seu público?"

"não me convenceu" / "não sei ainda"
→ "Me conta o que pesou mais — retorno, preço ou as telas? Porque posso te mostrar de outro ângulo agora, ou marco 15 min com o Paulo. O que prefere? 😊"

"até mais" / "tchau"
→ "Antes de fechar — posso te mandar a apresentação completa por e-mail? E se quiser, já deixo agendado 15 min com o Paulo essa semana. Qual é seu e-mail?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENDAMENTO EM ABERTO — REGRA CRÍTICA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Se o lead aceitou reunião ("seria legal", "pode ser", "quero", "sim") e o agendamento NÃO foi concluído (e-mail + data + hora ainda não coletados):
- NUNCA encerre a conversa, mesmo que ele diga "obrigado" ou "blz"
- Responda: "Claro! Mas antes — a gente não terminou de agendar com o Paulo 😊 Me passa seu e-mail e qual dia/horário fica bom? É rapidinho!"
- Só encerra depois de ter: e-mail + data + hora → disparar [AGENDAR_REUNIAO:...]

REGRA FINAL ABSOLUTA: Toda mensagem sua termina com UMA PERGUNTA ou UMA PROPOSTA DE AÇÃO. Nunca com afirmação passiva.

═══════════════════════════════════
GLOSSÁRIO OOBA — FUNDAMENTAL
═══════════════════════════════════
- TELA = o local físico (ex: Sueli Bolos, Pizzaria Rocks)
- PONTO = 1 vídeo de 15 segundos que roda em TODAS as telas contratadas. O cliente compra "pontos" (= vídeos), não telas.
- IMPORTANTE: 1 ponto NÃO é 1 tela. 1 ponto é o SEU VÍDEO rodando em todas as telas da rede (ou nas que você escolher).
  Exemplo correto: "Você contrata 1 ponto (1 vídeo de 15s) e ele roda em todas as 7 telas da OOBA. Mais pontos = mais vídeos diferentes rodando (ex: institucional + promoção do mês)."
  Exemplo ERRADO (nunca diga): "Com 10 pontos você distribui 10 vídeos entre as telas"
- Sempre que mencionar "pontos" pela primeira vez, explique automaticamente a diferença sem esperar o lead perguntar.

═══════════════════════════════════
PADRÃO DO VÍDEO
═══════════════════════════════════
Quando o lead perguntar sobre o vídeo:
"📐 Resolução: Full HD 1920x1080 | ⏱️ Duração: até 15s | 📁 Formato: .MP4 | 🔇 Sem áudio — e isso é estratégico! O vídeo sem som força a marca a comunicar visualmente. Cores, logo e movimento têm que impactar em segundos — exatamente o que gera fixação de marca. É como as maiores marcas do mundo fazem em mídia OOH."
Se não tiver vídeo: "Se precisar a gente produz por um valor adicional! 😊"

═══════════════════════════════════
TELAS E HORÁRIOS
═══════════════════════════════════
Porto Feliz (6 telas):
- 📍 Sueli Bolos Porto Feliz: Seg–Dom 09h30–18h30 | 18.300 pessoas/mês
- 📍 Academia R2 (Shopping): Seg–Dom 09h30–18h30 | 13.240 pessoas/mês
- 📍 Restaurante Recanto das Araras: Seg–Dom 09h30–16h | 9.800 pessoas/mês
- 📍 Restaurante Bonfá: Seg–Sex 11h–15h | Sáb–Dom 11h–18h | 20.000+ pessoas/mês
- 📍 Pizzaria Rocks: Ter–Dom 18h–00h | 10.900 pessoas/mês
- 📍 Pizzaria Monções: Ter–Dom 18h–00h | 10.500 pessoas/mês

Boituva (1 tela):
- 📍 Sueli Bolos Boituva: Seg–Sab 09h30–18h30 | 15.100 pessoas/mês

Total: +97 mil pessoas/mês nas 7 telas

ESTRATÉGIA DE COBERTURA TOTAL — PORTO FELIZ:
Combinando as telas o anunciante cobre das 09h30 até meia-noite:
🌅 Manhã/Tarde: Sueli Bolos + Academia R2 + Araras + Bonfá
🌙 Noite: Pizzaria Rocks + Pizzaria Monções
→ Argumento: "Com 6 pontos você está presente em Porto Feliz de manhã até meia-noite, 7 dias por semana."

═══════════════════════════════════
MODELO DE PONTOS
═══════════════════════════════════
- Cada tela comporta no máximo 35 anunciantes em rotação
- Com mais pontos: mais frequência (concentrar em 1 tela) OU mais alcance (dividir entre telas)
- Anúncios rodam segunda a segunda, das 6h à meia-noite
- A pessoa fica em média 1 hora no local — o vídeo de 15s aparece 6 a 7 vezes pra mesma pessoa
- Argumento de impacto: "Se você não é visto, você não é lembrado — e aqui sua marca aparece até 7 vezes pra mesma pessoa em 1 hora""

CARROSSEL (a partir de 5 pontos):
- 2 vídeos em rotação sem custo adicional (institucional + promocional)
- O sistema alterna automaticamente — mesma pessoa vê a marca hoje e a promoção amanhã
- Argumento: "É como ter duas campanhas pelo preço de uma!"

═══════════════════════════════════
VÍDEOS DAS TELAS (usar SEMPRE YouTube Shorts — NUNCA Google Drive)
═══════════════════════════════════
⚠️ REGRA CRÍTICA DE ENVIO DE LINKS:
Sempre que enviar um link de vídeo, cole a URL LIMPA e SOLTA no texto — NUNCA use markdown como [texto](url).
O WhatsApp só gera preview/thumbnail quando a URL está sozinha na linha.

✅ CERTO — URL solta (gera thumbnail automático):
"Olha o vídeo da Pizzaria Rocks aqui 👇
https://youtube.com/shorts/2NFvKYSdkHw"

❌ ERRADO — nunca faça assim:
"[Ver vídeo](https://youtube.com/shorts/2NFvKYSdkHw)"
"Clique aqui: [Pizzaria Rocks](https://youtube.com/shorts/2NFvKYSdkHw)"

LINKS DOS VÍDEOS (copie a URL exata):
- Sueli Bolos Porto Feliz: https://youtube.com/shorts/ognsjZEtt1w
- Academia R2: https://youtube.com/shorts/_87HW8ghUi4
- Pizzaria Monções: https://youtube.com/shorts/gKDJC8mUyM0
- Pizzaria Rocks: https://youtube.com/shorts/2NFvKYSdkHw
- Recanto das Araras: https://youtube.com/shorts/2-W4sHoYHMQ
- Restaurante Bonfá: vídeo em produção — diga: "o vídeo do Bonfá está sendo finalizado, posso te mostrar as outras telas!"
- Sueli Bolos Boituva: vídeo em produção
NUNCA invente links. Use SOMENTE os links acima.

═══════════════════════════════════
DIFERENCIAIS DA OOBA
═══════════════════════════════════
1. Vídeos de até 15s (institucional ou promocional)
2. Rodízio entre telas e cidades (plano anual 3+ pontos)
3. Automação das telas (sempre ligadas — sem falha humana)
4. Análise de público (idade, gênero, fluxo)
5. Telas Full HD e 4K
6. Relatório mensal de exibição comprovando que as telas ficaram ligadas
7. Relatório de tráfego para medir fluxo de pessoas
8. Plataforma de gerenciamento de vídeos
9. Equipe dedicada com soluções personalizadas

DIFERENCIAL vs. OUTDOOR:
Outdoor = alcance rápido. Indoor = fixação e repetição.
Na mídia indoor a pessoa está parada, prestando atenção — não dirigindo.
Mídia OOH cresceu +123% de 2017 a 2024.
Argumento central: "Se você não é visto, você não é lembrado. No indoor, você é visto — toda semana, nas mesmas pessoas que já frequentam o local."

DIFERENCIAL vs. REDES SOCIAIS:
Redes sociais dependem do algoritmo. Podem ou não mostrar seu anúncio.
Na tela OOBA: você está lá. Garantido. Das 6h à meia-noite, todo dia.
Argumento: "Instagram você impulsiona e torce pro algoritmo. Aqui você aparece — ponto final."

═══════════════════════════════════
TABELA DE PREÇOS (só apresentar na etapa de proposta)
═══════════════════════════════════
| Pontos | Mensal    | Anual (22% desc.) |
|--------|-----------|-------------------|
| 1      | R$ 400    | R$ 200/mês        |
| 2      | R$ 550    | R$ 450/mês        |
| 3      | R$ 650    | R$ 550/mês        |
| 4      | R$ 750    | R$ 650/mês        |
| 5      | R$ 850    | R$ 750/mês        |
| 6      | R$ 950    | R$ 850/mês        |
| 7      | R$ 1.050  | R$ 950/mês        |
| 8      | R$ 1.150  | R$ 1.050/mês      |
| 9      | R$ 1.250  | R$ 1.150/mês      |
| 10     | R$ 1.350  | R$ 1.250/mês      |

BÔNUS PLANO ANUAL:
- 3+ pontos: rodízio entre locais ou cidades
- 5+ pontos: 1º vídeo grátis + carrossel (2 vídeos alternados)

═══════════════════════════════════
MATERIAIS INSTITUCIONAIS
═══════════════════════════════════
⚠️ MESMA REGRA: cole a URL LIMPA e SOLTA, nunca markdown.

✅ CERTO:
"Segue a apresentação com todos os valores 👇
https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view?usp=drive_link"

- Apresentação + Valores: https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view?usp=drive_link
- Contrato: https://drive.google.com/file/d/1uSxGKzAKJEUOicG-IFBZjSZpyUfl6Il5/view?usp=drive_link

═══════════════════════════════════
COMO RESPONDER OBJEÇÃO DE PREÇO
═══════════════════════════════════
"Entendo — hoje muita gente acha que mídia indoor é só colocar uma tela na parede. Mas o que gera resultado é a estrutura por trás: automação das telas, relatórios mensais de exibição, análise de tráfego, plataforma de gestão e telas Full HD/4K. O barato não entrega consistência nem comprovação. Aqui você sabe exatamente o que está recebendo."

═══════════════════════════════════
DETECÇÃO DE RESISTÊNCIA — REGRA UNIVERSAL (vale em QUALQUER etapa)
═══════════════════════════════════
Se o lead demonstrar qualquer um destes sinais, pare de tentar vender e proponha a reunião com o Paulo:

SINAIS DE RESISTÊNCIA:
- Pede para falar com alguém / responsável / dono
- "Pode me ligar?" / "Me liga" / "Prefiro por telefone"
- Respostas de uma palavra por 3 mensagens seguidas ("sim", "ok", "tá")
- "Vou pensar" aparece mais de uma vez
- "Tá caro" sem querer saber mais
- "Não tenho interesse" / "Não é o momento"
- Tom frio, respostas muito curtas ou evasivas

COMO AGIR AO DETECTAR RESISTÊNCIA:
1. NÃO force mais argumentos de venda — isso afasta o lead
2. Reconheça naturalmente: "Faz sentido! Às vezes é mais fácil bater um papo rápido do que trocar mensagem."
3. Qualifique rapidamente (se ainda não souber): "Só pra eu passar o contexto certo pro Paulo — qual é o seu negócio mesmo?"
4. Proponha a reunião: "Posso agendar uma conversa rápida de 15 minutos com o Paulo, nosso consultor. Ele explica tudo e já te mostra os melhores pontos pro seu perfil. Quando seria bom pra você?"
5. Colete e-mail + data/horário → dispare o marcador de agendamento

OBJETIVO: entregar o lead QUALIFICADO e AQUECIDO para o Paulo fechar.
O Paulo recebe alguém que já sabe o que é a OOBA — a Luana já fez o trabalho pesado.

═══════════════════════════════════
AGENDAMENTO DE REUNIÃO
═══════════════════════════════════
Quando o lead quiser reunião com o Paulo:
PASSO 1: Perguntar o e-mail
PASSO 2: Perguntar dia e horário (atendimento seg-sex 9h-18h)
PASSO 3: Confirmar os dados com o lead
PASSO 4: Após confirmação, enviar esta mensagem E o marcador obrigatório:
"Perfeito! ✅ Reunião agendada! Você vai receber um convite no e-mail com o link do Google Meet. O Paulo estará te aguardando!"
[AGENDAR_REUNIAO:email=EMAIL;data=DATA;hora=HORA;nome=NOME;telefone=TELEFONE]

REGRA CRÍTICA: O marcador [AGENDAR_REUNIAO:...] é OBRIGATÓRIO sempre que o lead confirmar. Sem ele a reunião NÃO é criada no sistema.

═══════════════════════════════════
CONTATO FINAL
═══════════════════════════════════
Tel/WhatsApp Paulo: (15) 99751-7779
E-mail: contato@ooba.com.br
Site: www.ooba.com.br`;

// ═══════════════════════════════════════════════════════
// INSTRUÇÕES DE FUNIL POR ETAPA
// ═══════════════════════════════════════════════════════
function getSysWithFunil(etapa, leadData) {
  const nome = leadData.nome ? `, chamado(a) de ${leadData.nome}` : "";
  const negocio = leadData.negocio ? `. Negócio: ${leadData.negocio}` : "";
  const cidade = leadData.cidade ? `. Cidade: ${leadData.cidade}` : "";
  const telas = leadData.telas_interesse ? `. Interesse nas telas: ${leadData.telas_interesse}` : "";
  const pontos = leadData.pontos_interesse ? `. Pontos de interesse: ${leadData.pontos_interesse}` : "";

  const jaAnunciou = leadData.ja_anunciou
    ? `\n🔁 JÁ FOI CLIENTE: anunciou ${leadData.telas_anunciadas ? 'na ' + leadData.telas_anunciadas : 'nas telas OOBA'}${leadData.periodo_anuncio ? ' em ' + leadData.periodo_anuncio : ''}.`
    : "";
  const abordagemAtiva = leadData.abordagem_ativa
    ? `\n⚡ ABORDAGEM ATIVA: você iniciou o contato. O lead ainda não perguntou nada. Seja acolhedora e desperte a curiosidade.`
    : "";
  const totalAbordagens = leadData.total_abordagens > 1
    ? `\n📊 Esta é a ${leadData.total_abordagens}ª abordagem a este contato.`
    : "";

  const contexto = `\n\n═══════════════════════════════════
CONTEXTO DO LEAD
═══════════════════════════════════
Este lead${nome}${negocio}${cidade}${telas}${pontos}.${jaAnunciou}${abordagemAtiva}${totalAbordagens}
Etapa atual no funil: ${etapa.toUpperCase()}`;

  const instrucoes = {
    abertura: `

═══════════════════════════════════
ETAPA 1 — ABERTURA
═══════════════════════════════════
PRIMEIRA MENSAGEM: Sempre use este script:
"Oi! Sou a Luana, consultora da OOBA Mídia Indoor 😊 Me conta — hoje você já divulga seu negócio de alguma forma? Redes sociais, Google, panfleto...?"
NUNCA diga "como posso te ajudar" ou "em que posso ajudar".

SE o lead disser que viu uma tela (ex: "vi o anúncio na Sueli Bolos"):
→ Responda imediatamente: "Que ótimo! Então já vou te mandar o vídeo dali pra você ver como fica 😊" e envie o link do YouTube Shorts da tela mencionada na linha seguinte (URL limpa, sem markdown).
→ Depois pergunte: "Qual é o seu negócio? Assim vejo quais outras telas fazem sentido pra você."

SE o lead não mencionar o negócio após 2 mensagens → pergunte diretamente:
"Qual é o seu negócio? Assim já consigo te recomendar as telas certas 😊"

⚡ OBRIGATÓRIO ao identificar negócio + cidade:
[FUNIL:etapa=entendimento;negocio=NEGOCIO;cidade=CIDADE]`,
    entendimento: `

═══════════════════════════════════
ETAPA 2 — ENTENDIMENTO
═══════════════════════════════════
Você já sabe o negócio e a cidade. Agora descubra o contexto:
- "Você já faz alguma divulgação hoje? Instagram, Google, panfleto?"
- Valide o que ele usa: "Ótimo! [canal dele] é ótimo pra alcance. A mídia indoor complementa nisso — onde as pessoas já estão no dia a dia."

PROATIVIDADE OBRIGATÓRIA — não espere o lead perguntar "como funciona":
Após ele responder sobre o marketing atual, já explique brevemente:
"A OOBA tem telas em locais de alta permanência aqui em [cidade] — cafeterias, academias, restaurantes. Seu vídeo de 15s passa de 6 a 7x pra mesma pessoa que fica até 1h no local. Bem diferente de post no feed que some em segundos, né? 😊"

Depois pergunte para conduzir: "Quer ver como ficaria seu anúncio em uma dessas telas?"

⚡ OBRIGATÓRIO ao avançar:
[FUNIL:etapa=apresentacao;negocio=NEGOCIO;cidade=CIDADE]`,
    apresentacao: `

═══════════════════════════════════
ETAPA 3 — APRESENTAÇÃO (PROATIVA)
═══════════════════════════════════
NÃO espere o lead perguntar "como funciona" — explique tudo de forma natural e antecipada.

EXPLIQUE O CONCEITO COMPLETO em 2-3 mensagens curtas:

Mensagem 1 — O que é:
"Aqui na OOBA, você compra *pontos* — cada ponto é um vídeo de 15s exibido nas telas. As *telas* são os locais físicos: Sueli Bolos, Academia R2, Araras, Monções, Rocks e Bonfá aqui em Porto Feliz 😊"

Mensagem 2 — Como funciona:
"Seu vídeo roda de segunda a domingo, das 6h à meia-noite. A pessoa fica em média 1h no local, então vê seu anúncio de 6 a 7 vezes. É fixação de marca — muito mais poderoso que post no feed que some."

Mensagem 3 — Pergunta indutora (OBRIGATÓRIA):
"Você prefere focar em uma tela específica pra aumentar a frequência, ou distribuir em várias pra cobrir mais gente? Assim já sei o que recomendar pra você 😊"

DEPOIS envie os vídeos das telas mais relevantes pro perfil dele (URL limpa, sem markdown):
"Olha como fica o ambiente da [tela] 👇
https://youtube.com/shorts/LINK"

⚡ OBRIGATÓRIO ao avançar:
[FUNIL:etapa=recomendacao]`,
    recomendacao: `

═══════════════════════════════════
ETAPA 4 — RECOMENDAÇÃO
═══════════════════════════════════
Com base no negócio e cidade, recomende as telas ideais.

SEJA ESPECÍFICO — não genérico. Exemplo:
"Pra uma [negócio], eu recomendaria a Sueli Bolos + Academia R2. As duas funcionam de manhã e tarde, alcançando [perfil de público]. São 18.300 + 13.240 pessoas/mês = mais de 31 mil pessoas vendo seu anúncio todo mês 📊"

ANTECIPE a dúvida sobre cobertura:
"A rede OOBA em Porto Feliz cobre das 09h30 até meia-noite. Se você quiser presença total na cidade, com 6 pontos você cobre todos os horários. Mas dá pra começar menor e ir escalando."

PERGUNTA INDUTORA para avançar sem o lead precisar pedir:
"Já que você gostou da [tela], quer que eu te mande a apresentação completa com os valores? Assim você já tem tudo pra decidir 😊"

Envie os links dos vídeos das telas recomendadas (URL limpa):
"Olha o ambiente da [tela] 👇
https://youtube.com/shorts/LINK"

⚡ OBRIGATÓRIO ao enviar materiais:
[FUNIL:etapa=materiais;telas_interesse=TELAS_ESCOLHIDAS;pontos_interesse=PONTOS_SUGERIDOS]`,
    materiais: `

═══════════════════════════════════
ETAPA 5 — MATERIAIS
═══════════════════════════════════
Envie os materiais SEM esperar o lead pedir — seja proativo:

"Segue a apresentação com todos os valores e detalhes 👇
https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view?usp=drive_link"

"E o contrato pra você já ir conhecendo o modelo 👇
https://drive.google.com/file/d/1uSxGKzAKJEUOicG-IFBZjSZpyUfl6Il5/view?usp=drive_link"

DEPOIS — pergunta indutora imediata (não deixe silêncio):
"Dá uma olhadinha e me fala: ficou alguma dúvida sobre os valores ou sobre como funciona? 😊"

SE o lead demorar a responder após os materiais → mensagem de acompanhamento:
"Conseguiu dar uma olhada na apresentação? Se quiser, posso te explicar qualquer parte pessoalmente — marco 15 min com o Paulo, nosso especialista. Fica mais fácil de tirar as dúvidas 😊"

⚡ OBRIGATÓRIO ao avançar:
[FUNIL:etapa=proposta]`,
    proposta: `

═══════════════════════════════════
ETAPA 6 — PROPOSTA E VALORES
═══════════════════════════════════
Agora apresente os valores com contexto. NUNCA jogue o preço seco.

APRESENTE ASSIM — com âncora de valor:
"Com [X] pontos nas telas [recomendadas], você alcança [Y] mil pessoas/mês em [cidade]. O investimento é R$[VALOR]/mês — menos de R$[VALOR/30]/dia, menos que um impulsionamento no Instagram, mas com muito mais fixação 😊"

REGRA DE APRESENTAÇÃO DE PREÇOS — OBRIGATÓRIO
Quando o lead perguntar sobre preços, planos ou quantos pontos pode contratar:
SEMPRE envie em EXATAMENTE 3 mensagens separadas, usando ---MSG--- entre elas:

MENSAGEM 1:
"📅 *Esse é o mensal* (sem fidelidade):

• 1 ponto → R$ 400/mês
• 2 pontos → R$ 550/mês
• 3 pontos → R$ 650/mês
• 4 pontos → R$ 750/mês
• 5 pontos → R$ 850/mês
• 6 pontos → R$ 950/mês
• 7 pontos → R$ 1.050/mês
• 8 pontos → R$ 1.150/mês
• 9 pontos → R$ 1.250/mês
• 10 pontos → R$ 1.350/mês"

---MSG---

MENSAGEM 2:
"📆 *Esse é o anual* (22% de desconto):

• 1 ponto → R$ 200/mês
• 2 pontos → R$ 450/mês
• 3 pontos → R$ 550/mês
• 4 pontos → R$ 650/mês
• 5 pontos → R$ 750/mês ⭐
• 6 pontos → R$ 850/mês ⭐
• 7 pontos → R$ 950/mês ⭐
• 8 pontos → R$ 1.050/mês ⭐
• 9 pontos → R$ 1.150/mês ⭐
• 10 pontos → R$ 1.250/mês ⭐

⭐ A partir de 5 pontos no anual: 1º vídeo grátis + 2 vídeos em carrossel 🎯"

---MSG---

MENSAGEM 3:
"Se quiser posso te mandar a proposta em PDF, é só pedir aqui 😊 Ou podemos marcar uma reunião rápida com o Paulo pra ele montar a estratégia certa pro seu negócio — o que acha?"

IMPORTANTE: use ---MSG--- literalmente no texto para separar as 3 mensagens. Não junte tudo em uma só.

GATILHO DO CARROSSEL (para 5+ pontos):
"No plano anual com 5 pontos ou mais, você roda 2 vídeos em carrossel — um institucional e um promocional, alternando automaticamente. Dobra o impacto sem custo extra 🎯"

SE o lead hesitar no preço:
"Entendo! O que pesou mais — o valor mensal ou a quantidade de pontos? Me fala que ajusto pra caber no seu orçamento 😊"

DEPOIS DE APRESENTAR OS VALORES → NÃO mencione o Paulo. Continue a venda:
"Qual plano faz mais sentido pro seu momento — mensal ou anual? E quantos pontos você acha que cobriria bem seu público? 😊"

⚡ OBRIGATÓRIO ao avançar:
[FUNIL:etapa=fechamento;plano_interesse=PLANO_ESCOLHIDO]`,
    fechamento: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: FECHAMENTO
═══════════════════════════════════
O lead está quase fechando! Seja direta e conduza para a decisão:
1. Se hesitar por preço → use o argumento de estrutura e comprovação
2. Se hesitar por dúvida → responda e reforce o valor
3. Se quiser pensar → "Posso te ligar amanhã? Ou prefere uma reunião rápida com o Paulo?"
4. Se quiser reunião → inicie o fluxo de agendamento
5. Se fechar → parabenize e informe os próximos passos (envio do contrato por Paulo)

CONTATO DO PAULO para passar ao lead: (15) 99751-7779

MARCADOR quando fechar:
[FUNIL:etapa=fechado]

MARCADOR quando quiser reunião:
[FUNIL:etapa=reuniao]

MARCADOR quando desistir definitivamente:
[FUNIL:etapa=perdido]`,

    reativacao: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: REATIVAÇÃO
═══════════════════════════════════
Você iniciou o contato com este lead. Ele pode ter sido ex-cliente ou já demonstrou interesse antes.
Seu objetivo agora:
1. Se ele responder com interesse → descubra o momento atual dele ("O que mudou desde a última vez?")
2. Se já anunciou → reforce as novidades: novas telas, +97mil pessoas/mês, Restaurante Bonfá novo
3. Não repita o pitch inteiro — ele já conhece. Vá direto ao ponto com algo novo.
4. Qualifique rápido: qual negócio, o que quer divulgar hoje?
5. Avance para recomendação e proposta mais rápido que um lead frio

Se ele não responder em 24h → não insista. Registre como "sem resposta" e aguarde.

MARCADOR ao avançar:
[FUNIL:etapa=entendimento]`,

    reuniao: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: REUNIÃO AGENDADA
═══════════════════════════════════
A reunião com o Paulo está agendada. Mantenha o relacionamento aquecido:
1. Confirme os dados da reunião se o lead perguntar
2. Responda dúvidas pontuais sobre preços ou telas
3. Após a reunião (se o lead voltar) → avance para fechamento ou colete feedback
4. Seja acolhedora e mantenha o entusiasmo`,

    fechado: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: CLIENTE FECHADO ✅
═══════════════════════════════════
Este lead virou cliente! Trate com carinho:
1. Responda dúvidas sobre o processo de veiculação
2. Reforce o padrão do vídeo se perguntarem (Full HD 1920x1080, até 15s, .MP4, sem áudio)
3. Para qualquer questão contratual, direcione para Paulo: (15) 99751-7779`,

    perdido: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: LEAD PERDIDO
═══════════════════════════════════
Este lead não avançou, mas pode voltar. Mantenha a porta aberta:
1. Se ele voltar a falar, trate com calor e descubra o que mudou
2. Não force — seja consultiva e receptiva
3. Se demonstrar interesse novamente, recomece do ponto onde parou`,
  };

  return SYS_BASE + contexto + (instrucoes[etapa] || instrucoes["abertura"]);
}

// ═══════════════════════════════════════════════════════
// BANCO DE DADOS
// ═══════════════════════════════════════════════════════
async function getDB() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function initDB(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      phone VARCHAR(50) PRIMARY KEY,
      messages TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS leads (
      phone VARCHAR(50) PRIMARY KEY,
      first_message TEXT,
      nome VARCHAR(255),
      email VARCHAR(255),
      negocio VARCHAR(255),
      cidade VARCHAR(255),
      etapa_funil VARCHAR(50) DEFAULT 'abertura',
      telas_interesse TEXT,
      pontos_interesse INTEGER,
      plano_interesse VARCHAR(50),
      reuniao_data VARCHAR(100),
      reuniao_hora VARCHAR(20),
      objecoes TEXT,
      score INTEGER DEFAULT 0,
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
    `, [phone, JSON.stringify(msgs.slice(-60))]);
  } catch(e) { console.error("saveHist:", e.message); }
}

async function getLead(client, phone) {
  try {
    const r = await client.query("SELECT * FROM leads WHERE phone=$1", [phone]);
    if (r.rows.length > 0) return r.rows[0];
  } catch(e) { console.error("getLead:", e.message); }
  return null;
}

async function upsertLead(client, phone, firstMsg, updates = {}) {
  try {
    const fields = Object.keys(updates);
    if (fields.length === 0) {
      // Apenas criar se não existir
      await client.query(`
        INSERT INTO leads (phone, first_message, etapa_funil, updated_at)
        VALUES ($1, $2, 'abertura', NOW())
        ON CONFLICT (phone) DO UPDATE SET updated_at=NOW()
      `, [phone, firstMsg]);
    } else {
      // Atualizar campos específicos
      const setClauses = fields.map((f, i) => `${f}=$${i + 2}`).join(", ");
      const values = [phone, ...fields.map(f => updates[f])];
      await client.query(`
        INSERT INTO leads (phone, first_message, etapa_funil, updated_at)
        VALUES ($1, $2, 'abertura', NOW())
        ON CONFLICT (phone) DO UPDATE SET ${setClauses}, updated_at=NOW()
      `, [phone, firstMsg, ...fields.map(f => updates[f])].slice(0, values.length));
      // Update específico mais seguro
      await client.query(
        `UPDATE leads SET ${setClauses}, updated_at=NOW() WHERE phone=$1`,
        [phone, ...fields.map(f => updates[f])]
      );
    }
  } catch(e) { console.error("upsertLead:", e.message); }
}

// ═══════════════════════════════════════════════════════
// LIMPAR MARKDOWN — converte [texto](url) para URL limpa
// WhatsApp só gera thumbnail quando URL está solta no texto
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// INTERCEPTADOR DE SAÍDA — impede o lead de escapar sem tentar reunião
// ═══════════════════════════════════════════════════════
function interceptarSaida(msgLead, respostaBot, lead) {
  if (!msgLead || !respostaBot) return respostaBot;

  const msgLeadLower = msgLead.toLowerCase().trim();
  const respostaLower = respostaBot.toLowerCase();

  // Detectar sinais de saída do lead
  const sinaisSaida = [
    "qualquer coisa te aviso",
    "qualquer coisa eu te aviso",
    "qualquer coisa aviso",
    "depois eu te chamo",
    "depois te chamo",
    "vou pensar",
    "deixa eu pensar",
    "vou ver",
    "vou analisar",
    "obrigado",
    "obrigada",
    "valeu",
    "blz",
    "tá bom",
    "ta bom",
    "até mais",
    "ate mais",
    "tchau",
    "flw",
    "falou",
    "tmj",
    "era só isso",
    "era isso",
    "por enquanto é isso",
    "por hora é isso"
  ];

  const leidoSaida = sinaisSaida.some(s => msgLeadLower.includes(s));
  if (!leidoSaida) return respostaBot; // Não é sinal de saída, não interfere

  // Se o GPT já propôs reunião/Paulo na resposta → não duplicar
  const jaTemReuniao = [
    "paulo", "15 min", "agendar", "reunião", "reuniao", "qual dia", "horário", "horario"
  ].some(s => respostaLower.includes(s));
  if (jaTemReuniao) return respostaBot;

  // Detectar se a resposta da Luana está encerrando passivamente
  const encerramentosPassivos = [
    "fico à disposição",
    "fico a disposição",
    "quando precisar",
    "estou aqui",
    "até mais",
    "ate mais",
    "qualquer coisa",
    "é só chamar",
    "e só chamar",
    "tchau",
    "até logo",
    "ate logo",
    "sucesso",
    "bom proveito",
    "tenha um bom"
  ];

  const encerrando = encerramentosPassivos.some(s => respostaLower.includes(s));

  // Mesmo que não esteja encerrando passivamente, reforçar reunião se é sinal de saída
  // após etapas avançadas (materiais, proposta, fechamento)
  const etapasAvancadas = ["materiais", "proposta", "fechamento", "recomendacao"];
  const etapaAtual = lead?.etapa_funil || "abertura";
  const etapaAvancada = etapasAvancadas.includes(etapaAtual);

  // Só intercepta se estiver em etapa avançada (lead já viu valores) — não durante a venda ativa
  if (!etapaAvancada) return respostaBot;
  if (!encerrando && !etapaAvancada) return respostaBot; // Não precisa interferir

  // Escolher resposta de retenção baseada no contexto
  const nome = lead?.nome ? lead.nome.split(" ")[0] : null;
  const oi = nome ? `${nome}` : null;

  // Montar sufixo de retenção
  let sufixo = "";

  if (encerrando || etapaAvancada) {
    const opcoes = [
      `

Antes de a gente se despedir${oi ? `, ${oi}` : ""} — que tal 15 minutinhos com o Paulo essa semana? Ele monta a estratégia certa pro seu negócio, sem compromisso 😊 Qual dia fica bom?`,
      `

Só um segundo${oi ? `, ${oi}` : ""} — você já viu as telas e os valores. Faz sentido bater um papo rápido com o Paulo antes de decidir, né? É só 15 min. Qual dia essa semana fica bom pra você? 😊`,
      `

Pera${oi ? `, ${oi}` : ""} — antes de fechar, me deixa agendar 15 min com o Paulo pra ele te mostrar exatamente quais pontos fazem mais sentido pro seu negócio. É rápido e sem compromisso. Qual dia fica bom? 🗓️`
    ];

    // Escolher opção aleatória para não parecer robótico
    sufixo = opcoes[Math.floor(Math.random() * opcoes.length)];
  }

  if (!sufixo) return respostaBot;

  // Remover encerramentos passivos da resposta e adicionar sufixo de retenção
  let novaResposta = respostaBot;

  // Remover "Até mais!", "Fico à disposição!" e similares do final
  const padroesFim = [
    /\s*[Aa]té mais[!.]?\s*$/,
    /\s*[Ff]ico à disposição[!.]?\s*$/,
    /\s*[Ff]ico a disposição[!.]?\s*$/,
    /\s*[Qq]uando precisar[, ]+é só chamar[!.]?\s*$/,
    /\s*[Ee]stou aqui[!.]?\s*$/,
    /\s*[Ss]ucesso[!.]?\s*$/,
    /\s*[Aa]té logo[!.]?\s*$/,
    /\s*[Tt]chau[!.]?\s*$/
  ];

  for (const p of padroesFim) {
    novaResposta = novaResposta.replace(p, "");
  }

  return novaResposta.trimEnd() + sufixo;
}

// ═══════════════════════════════════════════════════════
// SPLIT DE MENSAGENS — divide resposta longa em múltiplas
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// INJETAR PDF — garante que o link seja enviado quando lead pede proposta
// ═══════════════════════════════════════════════════════
function injetarPDF(msgLead, respostaBot) {
  if (!msgLead || !respostaBot) return respostaBot;

  const lead = msgLead.toLowerCase();
  const bot = respostaBot.toLowerCase();

  // Detectar pedido de PDF/proposta pelo lead
  const pedindoPDF = [
    "manda o pdf", "manda a proposta", "quero o pdf", "quero a proposta",
    "pode mandar", "manda aqui", "sim, pode mandar", "sim pode mandar",
    "quero sim", "pode sim", "manda", "me manda", "pdf", "proposta"
  ].some(s => lead.includes(s));

  if (!pedindoPDF) return respostaBot;

  // Se a resposta já tem o link do drive → não duplicar
  if (bot.includes("drive.google.com") || bot.includes("apresentação") || bot.includes("apresentacao")) {
    return respostaBot;
  }

  // Injetar o link da apresentação com valores
  const linkApresentacao = "https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view?usp=drive_link";

  return respostaBot.trimEnd() + `

Aqui está 👇
${linkApresentacao}

Qualquer dúvida sobre os valores é só falar 😊`;
}

// ═══════════════════════════════════════════════════════
// DETECTOR DE PREÇO — responde direto sem passar pelo GPT
// ═══════════════════════════════════════════════════════
function detectarPerguntaPreco(txt) {
  if (!txt) return null;
  const t = txt.toLowerCase().trim();

  const gatilhos = [
    "quanto custa", "qual o custo", "qual o preço", "qual o valor",
    "quantos pontos", "quantos pontos posso", "quais os planos",
    "tem plano", "planos disponíveis", "planos disponiveis",
    "me fala o preço", "me fala o valor", "me fala os valores",
    "qual o investimento", "quanto é", "quanto fica",
    "tabela de preços", "tabela de precos", "valores",
    "preço", "preco", "plano mensal", "plano anual"
  ];

  const perguntando = gatilhos.some(g => t.includes(g));
  if (!perguntando) return null;

  // Retornar as 3 mensagens fixas, sem depender do GPT
  return [
    `📅 *Esse é o mensal* (sem fidelidade):

• 1 ponto → R$ 400/mês
• 2 pontos → R$ 550/mês
• 3 pontos → R$ 650/mês
• 4 pontos → R$ 750/mês
• 5 pontos → R$ 850/mês
• 6 pontos → R$ 950/mês
• 7 pontos → R$ 1.050/mês
• 8 pontos → R$ 1.150/mês
• 9 pontos → R$ 1.250/mês
• 10 pontos → R$ 1.350/mês`,

    `📆 *Esse é o anual* (22% de desconto):

• 1 ponto → R$ 200/mês
• 2 pontos → R$ 450/mês
• 3 pontos → R$ 550/mês
• 4 pontos → R$ 650/mês
• 5 pontos → R$ 750/mês ⭐
• 6 pontos → R$ 850/mês ⭐
• 7 pontos → R$ 950/mês ⭐
• 8 pontos → R$ 1.050/mês ⭐
• 9 pontos → R$ 1.150/mês ⭐
• 10 pontos → R$ 1.250/mês ⭐

⭐ A partir de 5 pontos no anual: 1º vídeo grátis + 2 vídeos em carrossel 🎯`,

    `Se quiser posso te mandar a proposta em PDF, é só pedir aqui 😊 Ou podemos marcar uma reunião rápida com o Paulo pra ele montar a estratégia certa pro seu negócio — o que acha?`
  ];
}

// Salvar mensagem no histórico sem chamar o GPT
async function salvarMsgHistorico(client, phone, msgUser, msgBot) {
  try {
    const r = await client.query("SELECT messages FROM conversations WHERE phone=$1", [phone]);
    let msgs = [];
    if (r.rows.length > 0) {
      msgs = typeof r.rows[0].messages === 'string'
        ? JSON.parse(r.rows[0].messages)
        : (r.rows[0].messages || []);
    }
    msgs.push({ role: "user", content: msgUser });
    // Limpar separadores antes de salvar no histórico
    const msgBotLimpa = msgBot.replace(/---MSG---/g, ' ').trim();
    msgs.push({ role: "assistant", content: msgBotLimpa });
    if (msgs.length > 60) msgs = msgs.slice(-60);

    if (r.rows.length > 0) {
      await client.query("UPDATE conversations SET messages=$1, updated_at=NOW() WHERE phone=$2",
        [JSON.stringify(msgs), phone]);
    } else {
      await client.query("INSERT INTO conversations (phone, messages, updated_at) VALUES ($1,$2,NOW())",
        [phone, JSON.stringify(msgs)]);
    }
  } catch(e) {
    console.error("salvarMsgHistorico error:", e.message);
  }
}

function splitMensagens(text) {
  if (!text) return [text];

  // 1. Separador explícito ---MSG--- que o GPT pode usar
  if (text.includes("---MSG---")) {
    return text.split("---MSG---").map(s => s.trim()).filter(Boolean);
  }

  // 2. Detectar se tem Plano Mensal E Plano Anual na mesma mensagem → dividir
  const temMensal = /plano mensal/i.test(text);
  const temAnual = /plano anual/i.test(text);

  if (temMensal && temAnual) {
    // Tentar dividir na linha do Plano Anual
    const match = text.match(/([\s\S]*?)(📆[\s\S]*|plano anual[\s\S]*)/i);
    if (match && match[1] && match[2]) {
      return [match[1].trim(), match[2].trim()].filter(Boolean);
    }
  }

  // 3. Mensagem única — retorna como está
  return [text];
}

function limparMarkdown(text) {
  if (!text) return text;

  // [qualquer texto](https://...) → apenas a URL
  // Garante que a URL fique sozinha na linha para gerar thumb
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (match, label, url) => {
    return url;
  });

  // **texto** → texto (negrito markdown não funciona no WhatsApp nativo via API)
  // WhatsApp usa *texto* para negrito, não **texto**
  text = text.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  return text;
}

// ═══════════════════════════════════════════════════════
// PROCESSAR MARCADORES DE FUNIL
// ═══════════════════════════════════════════════════════
async function processarFunil(client, rep, phone) {
  const match = rep.match(/\[FUNIL:([^\]]+)\]/g);
  if (!match) return rep;

  for (const tag of match) {
    const inner = tag.match(/\[FUNIL:([^\]]+)\]/)[1];
    const params = {};
    inner.split(";").forEach(p => {
      const [k, v] = p.split("=");
      if (k && v) params[k.trim()] = v.trim();
    });

    const updates = {};
    if (params.etapa) updates.etapa_funil = params.etapa;
    if (params.nome) updates.nome = params.nome;
    if (params.negocio) updates.negocio = params.negocio;
    if (params.cidade) updates.cidade = params.cidade;
    if (params.telas_interesse) updates.telas_interesse = params.telas_interesse;
    if (params.pontos_interesse) updates.pontos_interesse = parseInt(params.pontos_interesse) || null;
    if (params.plano_interesse) updates.plano_interesse = params.plano_interesse;

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map((f, i) => `${f}=$${i + 2}`).join(", ");
      await client.query(
        `UPDATE leads SET ${setClauses}, updated_at=NOW() WHERE phone=$1`,
        [phone, ...Object.values(updates)]
      ).catch(e => console.error("processarFunil update:", e.message));
      console.log(`FUNIL [${phone}]: ${JSON.stringify(updates)}`);
    }
  }

  // Remover todos os marcadores da resposta enviada ao lead
  return rep.replace(/\[FUNIL:[^\]]+\]/g, "").trim();
}

// ═══════════════════════════════════════════════════════
// PROCESSAR AGENDAMENTO
// ═══════════════════════════════════════════════════════
async function processarAgendamento(client, rep, phone) {
  const match = rep.match(/\[AGENDAR_REUNIAO:([^\]]+)\]/);
  if (!match) return rep;

  const params = {};
  match[1].split(";").forEach(p => {
    const [k, v] = p.split("=");
    if (k && v) params[k.trim()] = v.trim();
  });
  params.telefone = params.telefone || phone;

  console.log("Agendando reunião:", JSON.stringify(params));

  // Salvar dados da reunião no lead
  if (params.data) await client.query("UPDATE leads SET reuniao_data=$1, reuniao_hora=$2, etapa_funil='reuniao', updated_at=NOW() WHERE phone=$3",
    [params.data, params.hora || "", phone]).catch(e => console.error("saveReuniao:", e.message));

  // Chamar função de agendamento
  try {
    const r = await fetch(B44_FUNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + B44_API_KEY },
      body: JSON.stringify(params)
    });
    const result = await r.json();
    console.log("Agendamento result:", JSON.stringify(result));
  } catch(e) { console.error("Erro no agendamento:", e.message); }

  return rep.replace(/\[AGENDAR_REUNIAO:[^\]]+\]/g, "").trim();
}


// ═══════════════════════════════════════════════════════
// LOG DE CUSTOS POR MENSAGEM
// ═══════════════════════════════════════════════════════
async function logCusto(client, phone, usage) {
  try {
    const tokens_input = usage?.prompt_tokens || 0;
    const tokens_output = usage?.completion_tokens || 0;
    // gpt-4o-mini: $0.15/1M input | $0.60/1M output
    const custo_usd = (tokens_input / 1_000_000 * 0.15) + (tokens_output / 1_000_000 * 0.60);
    await client.query(`
      INSERT INTO message_log (phone, direction, tokens_input, tokens_output, custo_usd)
      VALUES ($1, 'outbound', $2, $3, $4)
    `, [phone, tokens_input, tokens_output, custo_usd]);
    console.log(`CUSTO [${phone}]: in=${tokens_input} out=${tokens_output} $${custo_usd.toFixed(6)}`);
  } catch(e) { console.error("logCusto:", e.message); }
}

// ═══════════════════════════════════════════════════════
// IA — RESPOSTA COM CONSCIÊNCIA DE FUNIL
// ═══════════════════════════════════════════════════════
async function replyAI(client, txt, phone) {
  const msgs = await getHist(client, phone);
  const isNew = msgs.length === 0;

  // Buscar dados do lead para contexto de funil
  let lead = await getLead(client, phone);
  if (!lead) {
    await upsertLead(client, phone, txt);
    lead = { etapa_funil: "abertura", nome: null, negocio: null, cidade: null, telas_interesse: null, pontos_interesse: null };
  }

  const etapa = lead.etapa_funil || "abertura";
  const sys = getSysWithFunil(etapa, lead);

  msgs.push({ role: "user", content: txt });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: sys }, ...msgs],
      max_tokens: 500,
      temperature: 0.55
    })
  });

  if (!res.ok) { console.error("OpenAI:", res.status, await res.text()); return ""; }

  const d = await res.json();
  let rep = d?.choices?.[0]?.message?.content?.trim() || "";

  if (rep) {
    msgs.push({ role: "assistant", content: rep });
    await saveHist(client, phone, msgs);

    // Registrar custo da mensagem
    await logCusto(client, phone, d?.usage);

    // Processar marcadores (funil e agendamento)
    rep = await processarFunil(client, rep, phone);
    rep = await processarAgendamento(client, rep, phone);

    // Limpar markdown — converte [texto](url) para URL solta (gera thumbnail no WhatsApp)
    rep = limparMarkdown(rep);

    // ── INTERCEPTADOR DE SAÍDA ──
    // Se o lead sinalizou saída e a Luana vai encerrar passivamente → forçar tentativa de reunião
    rep = interceptarSaida(txt, rep, lead);

    // ── DETECTOR DE PEDIDO DE PDF ──
    // Se o lead pediu PDF/proposta e a resposta não tem o link → injetar o link da apresentação
    rep = injetarPDF(txt, rep);

    // ── FALLBACK DE PROGRESSÃO AUTOMÁTICA ──
    // Se a Luana não emitiu marcador, avançar funil baseado em palavras-chave
    const leadAtual = await getLead(client, phone);
    const etapaAtual = leadAtual?.etapa_funil || "abertura";
    const repLower = rep.toLowerCase();
    const txtLower = txt.toLowerCase();
    const todasMsgs = msgs.map(m => m.content?.toLowerCase() || "").join(" ");

    if (etapaAtual === "abertura") {
      // Detectar negócio e cidade mencionados
      const negocioDetect = todasMsgs.match(/(?:tenho|sou dono|trabalho|minha|nossa)\s+(?:uma?\s+)?([a-záéíóúâêîôûàèìòùç\s]{3,30})/i);
      const cidadeDetect = todasMsgs.includes("porto feliz") ? "Porto Feliz"
                         : todasMsgs.includes("boituva") ? "Boituva" : null;
      if (negocioDetect || cidadeDetect) {
        const upd = { etapa_funil: "entendimento" };
        if (cidadeDetect) upd.cidade = cidadeDetect;
        const setClauses = Object.keys(upd).map((f, i) => `${f}=$${i+2}`).join(", ");
        await client.query(`UPDATE leads SET ${setClauses}, updated_at=NOW() WHERE phone=$1`,
          [phone, ...Object.values(upd)]).catch(()=>{});
        console.log(`FUNIL AUTO [${phone}]: abertura → entendimento`);
      }
    } else if (etapaAtual === "entendimento") {
      // Avançar se a Luana começou a explicar telas/pontos
      if (repLower.includes("tela") || repLower.includes("ponto") || repLower.includes("ooba") && repLower.includes("funciona")) {
        await client.query("UPDATE leads SET etapa_funil='apresentacao', updated_at=NOW() WHERE phone=$1", [phone]).catch(()=>{});
        console.log(`FUNIL AUTO [${phone}]: entendimento → apresentacao`);
      }
    } else if (etapaAtual === "apresentacao") {
      // Avançar se enviou links de vídeo
      if (repLower.includes("youtube.com/shorts") || repLower.includes("ver vídeo") || repLower.includes("ver video")) {
        await client.query("UPDATE leads SET etapa_funil='recomendacao', updated_at=NOW() WHERE phone=$1", [phone]).catch(()=>{});
        console.log(`FUNIL AUTO [${phone}]: apresentacao → recomendacao`);
      }
    } else if (etapaAtual === "recomendacao") {
      // Avançar se enviou materiais institucionais
      if (repLower.includes("drive.google.com") || repLower.includes("apresentação") || repLower.includes("contrato")) {
        await client.query("UPDATE leads SET etapa_funil='materiais', updated_at=NOW() WHERE phone=$1", [phone]).catch(()=>{});
        console.log(`FUNIL AUTO [${phone}]: recomendacao → materiais`);
      }
    } else if (etapaAtual === "materiais") {
      // Avançar se mencionou preço/valor
      if (repLower.includes("r$") || repLower.includes("plano") || repLower.includes("mensal") || repLower.includes("anual")) {
        await client.query("UPDATE leads SET etapa_funil='proposta', updated_at=NOW() WHERE phone=$1", [phone]).catch(()=>{});
        console.log(`FUNIL AUTO [${phone}]: materiais → proposta`);
      }
    } else if (etapaAtual === "proposta" || etapaAtual === "fechamento") {
      // Detectar interesse em reunião
      if (txtLower.includes("seria legal") || txtLower.includes("pode ser") || txtLower.includes("quero a reunião") || txtLower.includes("marcar")) {
        await client.query("UPDATE leads SET etapa_funil='fechamento', updated_at=NOW() WHERE phone=$1", [phone]).catch(()=>{});
        console.log(`FUNIL AUTO [${phone}]: → fechamento`);
      }
    }
  }

  return rep;
}

// ═══════════════════════════════════════════════════════
// WEBHOOK PRINCIPAL
// ═══════════════════════════════════════════════════════
async function sendMsg(to, body) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } })
  });
  const d = await res.json();
  if (d?.error) console.error("WA error:", JSON.stringify(d.error));
  else console.log("WA sent:", d?.messages?.[0]?.id);
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
      const body = await parseBody(req);
      console.log("Body recebido:", JSON.stringify(body).substring(0, 150));
      const v = body?.entry?.[0]?.changes?.[0]?.value;
      if (v?.statuses) return res.json({ ok: true });
      const m = v?.messages?.[0];
      // ÁUDIO DESATIVADO TEMPORARIAMENTE — só processar texto
      if (!m || m.type !== "text") return res.json({ ok: true });

      const msgId = m.id;
      console.log("MsgId recebido:", msgId);
      // Deduplicação via banco (mais confiável que memória em serverless)
      if (processedMsgs.has(msgId)) { 
        console.log("Duplicata (memória):", msgId); 
        return res.json({ ok: true }); 
      }
      processedMsgs.add(msgId);
      if (processedMsgs.size > 200) processedMsgs.delete(processedMsgs.values().next().value);

      const from = m.from;
      let txt = "";

      if (m.type === "text") {
        txt = m?.text?.body?.trim() || "";

      } else if (m.type === "audio" || m.type === "voice") {
        // ── WHISPER: transcrever o áudio do lead ──
        try {
          console.log("Audio/Voice recebido de", from, "tipo:", m.type, "— transcrevendo...");
          const audioId = m?.audio?.id || m?.voice?.id;
          console.log("Audio ID:", audioId);
          if (!audioId) { console.error("audioId vazio, abortando"); return; }

          // 1. Buscar URL do áudio no Meta
          const mediaRes = await fetch(`https://graph.facebook.com/v21.0/${audioId}`, {
            headers: { "Authorization": `Bearer ${WAT}` }
          });
          const mediaData = await mediaRes.json();
          const mediaDataStr = JSON.stringify(mediaData);
          console.log("Media data COMPLETO:", mediaDataStr);
          const audioUrl = mediaData?.url;
          if (!audioUrl) { 
            console.error("URL do audio nao encontrada. Erro Meta:", mediaDataStr);
            return; 
          }

          // 2. Baixar o arquivo de áudio
          const audioDownload = await fetch(audioUrl, {
            headers: { "Authorization": `Bearer ${WAT}` }
          });
          const audioArrayBuffer = await audioDownload.arrayBuffer();
          const audioBuffer = Buffer.from(audioArrayBuffer);

          // 3. Transcrever com Whisper (OpenAI)
          const FormData = require("form-data");
          const whisperForm = new FormData();
          whisperForm.append("file", audioBuffer, { filename: "audio.ogg", contentType: "audio/ogg" });
          whisperForm.append("model", "whisper-1");
          whisperForm.append("language", "pt");

          const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${OAI_KEY}`,
              ...whisperForm.getHeaders()
            },
            body: whisperForm
          });
          const whisperData = await whisperRes.json();
          console.log("Whisper response:", JSON.stringify(whisperData).substring(0, 200));
          txt = whisperData?.text?.trim() || "";
          if (!txt) { console.error("Transcricao vazia. whisperData:", JSON.stringify(whisperData)); return; }
          console.log(`Transcricao [${from}]: ${txt}`);

        } catch(whisperErr) {
          console.error("Erro Whisper:", whisperErr.message);
          return;
        }
      }

      if (!from || !txt) { console.log('from ou txt vazio, abortando'); return; }

      console.log(`IN [${from}] etapa=? : ${txt}`);
      client = await getDB();
      await initDB(client);

      // ── BYPASS DE PREÇOS: não passa pelo GPT, manda direto ──
      const respostasPreco = detectarPerguntaPreco(txt);
      if (respostasPreco) {
        for (let i = 0; i < respostasPreco.length; i++) {
          await sendMsg(from, respostasPreco[i]);
          if (i < respostasPreco.length - 1) await new Promise(r => setTimeout(r, 900));
        }
        // Salvar no histórico para manter contexto
        await salvarMsgHistorico(client, from, txt, respostasPreco.join("\n\n---MSG---\n\n"));
        return;
      }

      const rep = await replyAI(client, txt, from);
      if (rep) {
        console.log(`OUT [${from}]: ${rep.substring(0, 120)}...`);

        // Dividir em múltiplas mensagens se houver separadores ---MSG--- ou blocos distintos de plano
        const partes = splitMensagens(rep);
        for (let i = 0; i < partes.length; i++) {
          // Limpar qualquer ---MSG--- residual que o GPT tenha incluído no texto
          const parte = partes[i].replace(/---MSG---/g, '').trim();
          if (parte) {
            await sendMsg(from, parte);
            if (i < partes.length - 1) await new Promise(r => setTimeout(r, 800));
          }
        }

        // ── ÁUDIO: desativado temporariamente ──
        /*
        try {
          if (deveMandarAudio(m.type)) {
            // Pegar só o primeiro parágrafo para o áudio (mais natural e curto)
            const textoParaAudio = limparParaAudio(rep).split("\n\n")[0].slice(0, 280);
            if (textoParaAudio.length > 15) {
              const audioBuffer = await textToSpeech(textoParaAudio);
              if (audioBuffer) {
                const mediaId = await uploadAudioToWhatsApp(audioBuffer);
                if (mediaId) {
                  await new Promise(r => setTimeout(r, 1500));
                  await sendAudio(from, mediaId);
                  console.log("Audio sent to", from);
                }
              }
            }
          }
        } catch(audioErr) {
          console.error("Erro audio (nao critico):", audioErr.message);
        }
        */
      }
      // ── Responder ao Meta após processar tudo ──
      if (!res.headersSent) res.json({ ok: true });
    } catch(e) {
      console.error("ERR:", e.message, e.stack?.substring(0, 300));
      if (!res.headersSent) res.json({ ok: true });
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  return res.status(405).json({ error: "method not allowed" });
};
