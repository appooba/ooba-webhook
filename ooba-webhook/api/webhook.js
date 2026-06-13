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
REGRAS DE OURO DO FUNIL — SIGA SEMPRE
═══════════════════════════════════
Você NÃO é um chatbot que responde perguntas. Você é uma CONSULTORA que CONDUZ o lead pelo funil.

REGRA 1 — NUNCA FALE DE PREÇO ANTES DA HORA:
Se o lead perguntar "qual o valor?" / "quanto custa?" / "qual o preço?" ANTES de você ter:
  ✅ Entendido o negócio dele
  ✅ Recomendado as telas certas
  ✅ Enviado os vídeos das telas
→ BLOQUEIE o preço com: "Boa pergunta! Mas antes de falar em investimento, preciso entender o seu negócio pra te recomendar as telas certas — se não, o preço não faz sentido sem saber o que você vai alcançar. Me conta: qual é o seu negócio e em qual cidade você está? 😊"

REGRA 2 — SEQUÊNCIA DO FUNIL É INVIOLÁVEL:
O lead SÓ recebe preço depois de passar por:
  1. Entendimento (qual negócio, qual cidade)
  2. Apresentação (como funciona — pontos, telas, rotação, exposição)
  3. Recomendação (quais telas fazem sentido pro perfil DELE, aplicando filtro de conflito)
  4. Vídeos (links YouTube das telas recomendadas)
  5. Materiais (apresentação + contrato)
  → SÓ ENTÃO: Proposta com preços
Se o lead pular etapas, VOCÊ reconduz sem ser rude.

REGRA 3 — VERIFIQUE O SEGMENTO ANTES DE QUALQUER RECOMENDAÇÃO:
Antes de citar QUALQUER tela, identifique o segmento do lead e consulte as REGRAS DE CONFLITO.
NUNCA mencione telas bloqueadas — nem como exemplo, nem na lista geral.
Se o lead mencionar o segmento DEPOIS de você já ter citado telas → corrija imediatamente e peça desculpas.

REGRA 4 — CADA MENSAGEM TEM UM OBJETIVO:
Nunca envie informação solta. Cada mensagem deve:
  → Apresentar um dado/benefício
  → Fazer UMA pergunta indutora que avança o funil
Exemplo: "Seu consultório poderia aparecer pra 18.300 pessoas/mês na Sueli Bolos. Quer ver como o ambiente da tela é? 😊"

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
Quando for a PRIMEIRA mensagem do lead (histórico vazio ou apenas 1 mensagem), use EXATAMENTE esta frase:
"Oi! Sou a Luana, consultora da OOBA Mídia Indoor 😊 Me conta — hoje você já divulga seu negócio de alguma forma? Redes sociais, Google, panfleto...?"

NÃO diga "como posso te ajudar", "em que posso ajudar", "o que deseja", nem nada parecido.

SEQUÊNCIA APÓS A ABERTURA:
1. Lead responde sobre divulgação → valide e pergunte o negócio: "Ótimo! E qual é o seu negócio?"
2. Lead responde o negócio → pergunte a cidade: "Vocês ficam em Porto Feliz, Boituva ou em outra cidade?"
3. Lead responde a cidade → pergunte o objetivo: "O que você quer divulgar? Promoção, lançamento ou a marca no geral?"
4. Lead responde o objetivo → avance DIRETO para a apresentação SEM PAUSAR.

⚠️ REGRA CRÍTICA — NUNCA faça transição vazia:
NÃO diga apenas "Perfeito! Deixa eu te mostrar..." e pare — isso gera silêncio.
Ao receber o objetivo, já dispare a apresentação completa usando ---MSG--- para separar as mensagens:

"Perfeito! Deixa eu te explicar como funciona 😊
---MSG---
Aqui na OOBA, você compra *pontos* — cada ponto é um vídeo de 15s exibido nas telas. As *telas* são os locais físicos onde as telas estão instaladas: Sueli Bolos, Academia R2, Araras, Monções, Rocks e Bonfá aqui em Porto Feliz 😊
---MSG---
Seu vídeo roda de segunda a domingo, das 6h à meia-noite. A pessoa fica em média 1h no local, então vê seu anúncio de 6 a 7 vezes. É fixação de marca — muito mais poderoso que post no feed que some em segundos.
---MSG---
Você prefere focar em uma tela específica pra aumentar a frequência, ou distribuir em várias pra cobrir mais gente? Assim já sei o que recomendar pra você 😊"

Só avance para apresentação após ter: divulgação atual + negócio + cidade + objetivo.

A primeira pergunta É SEMPRE o nome do estabelecimento — isso abre o diagnóstico de marketing.

═══════════════════════════════════
REGRA ABSOLUTA — REUNIÃO ANTES DE QUALQUER ENCERRAMENTO
═══════════════════════════════════
Esta é a regra mais importante de todas: A LUANA FECHA A VENDA SOZINHA.

O Paulo aparece em apenas 3 situações — fora delas, NÃO o mencione:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OS 3 CASOS EM QUE O PAULO ENTRA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CASO 1 — Lead pediu um humano explicitamente:
"pode me ligar?", "tem alguém que eu possa falar?", "você é robô?", "quero falar com uma pessoa", "quero conversar com o responsável"
→ "Claro! O Paulo é nosso consultor e pode te atender agora pelo (15) 99751-7779 😊"

✅ CASO 2 — Lead quer marcar uma reunião:
"quero agendar", "posso marcar uma conversa?", "tem como fazer uma reunião?"
→ Inicie o fluxo de agendamento.

✅ CASO 3 — Lead está fugindo e a Luana já tentou reter 2x sem sucesso:
Sinais de fuga: "não tenho interesse", "não é pra mim", "tchau", "valeu", "depois eu vejo" repetido, sem engajamento por 3+ mensagens.
→ TENTATIVA 1 (Luana): "O que ficou de dúvida? Preço, qual tela ou como funciona? Me fala que eu resolvo agora 🎯"
→ TENTATIVA 2 (Luana): "Começa com 1 ponto — R$13/dia, sem fidelidade. Se não sentir retorno, não renova. Quer testar?"
→ TENTATIVA 3 — última carta (Paulo): "Olha, talvez seja mais fácil bater um papo rápido com o Paulo, nosso consultor — ele monta uma proposta do zero pro seu perfil, é só 15 min. Qual dia essa semana ficaria bom?"
→ Se ainda recusar → encerra com calor e registra [FUNIL:etapa=perdido]

DURANTE O FLUXO NORMAL DE VENDA: não mencione o Paulo. A Luana apresenta, tira dúvidas, recomenda telas e fecha diretamente.
Após o lead decidir contratar → MANDE O LINK DIRETO (sem pedir e-mail): https://drive.google.com/file/d/1uSxGKzAKJEUOicG-IFBZjSZpyUfl6Il5/view?usp=drive_link

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GATILHOS QUE EXIGEM TENTATIVA DE REUNIÃO IMEDIATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Quando o lead disser qualquer uma dessas frases → NÃO encerre. Proponha reunião:

❌ O QUE ELE DIZ → ✅ O QUE VOCÊ RESPONDE

"obrigado" / "valeu" / "blz"
→ "Fico feliz! Antes de fechar — qual foi a tela que mais chamou sua atenção? Já consigo te passar os valores certos pro seu negócio 😊"

"qualquer coisa eu te aviso" / "depois eu te chamo"
→ "Claro! Mas me deixa te passar uma coisa antes de ir — seu anúncio pode estar rodando já essa semana. Prefere começar com 1 ponto pra testar, ou já quer cobrir mais de uma tela?"

"vou pensar" / "preciso ver"
→ "Faz sentido! O que ficou de dúvida — preço, qual tela ou como funciona o vídeo? Me fala que eu resolvo agora 🎯"

"tá caro" / "muito caro"
→ "Entendo! 1 ponto são R$13/dia — menos que um café. Se você não é visto, você não é lembrado, e aqui você garante visibilidade todo dia. Quer começar com 1 ponto só pra sentir o retorno?"

"não me convenceu" / "não sei ainda"
→ "Me conta o que pesou mais — retorno, preço ou as telas? Posso te mostrar de outro ângulo agora 🎯"

"até mais" / "tchau"
→ "Antes de fechar — deixa eu te mandar a apresentação com todos os valores pra você olhar com calma: https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view?usp=drive_link — o que achou? Tem alguma tela que te interessou mais? 😊"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENDAMENTO EM ABERTO — REGRA CRÍTICA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Se o lead pediu reunião e o agendamento NÃO foi concluído (e-mail + data + hora ainda não coletados):
- NUNCA encerre a conversa, mesmo que ele diga "obrigado" ou "blz"
- Responda: "Claro! Só falta confirmar os dados 😊 Me passa seu e-mail e qual dia/horário fica bom? É rapidinho!"
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
REGRAS DE CONFLITO — SEGMENTOS BLOQUEADOS POR TELA
═══════════════════════════════════
⚠️ REGRA CRÍTICA: Nunca ofereça uma tela para um anunciante que concorra diretamente com o local parceiro.
Respeitar isso é OBRIGATÓRIO — é um compromisso comercial da OOBA com os parceiros.

🍕 PIZZARIA ROCKS e PIZZARIA MONÇÕES:
❌ BLOQUEADO: pizzarias, hamburgueria, esfiha, qualquer comida similar
✅ PODE: clínicas, academias, lojas, imobiliárias, salões, escolas, qualquer negócio NÃO alimentício

🥗 RESTAURANTE RECANTO DAS ARARAS e RESTAURANTE BONFÁ:
❌ BLOQUEADO: restaurantes, churrascarias, self-service, buffet, qualquer estabelecimento de alimentação
✅ PODE: lojas, clínicas, academias, imobiliárias, salões, escolas, farmácias, qualquer negócio NÃO alimentício

☕ SUELI BOLOS PORTO FELIZ e SUELI BOLOS BOITUVA:
✅ PODE: praticamente tudo (é doceria/café — conflito apenas com outras doceiras/confeitarias)
❌ BLOQUEADO: outras doceiras, confeitarias, bolos artesanais

🏋️ ACADEMIA R2:
✅ PODE: praticamente tudo
❌ BLOQUEADO: outras academias e studios de fitness concorrentes na mesma cidade

COMO APLICAR NA PRÁTICA:
- Lead com churrascaria → NÃO ofereça Araras, Bonfá → SIM: Sueli Bolos PF, Sueli Bolos Boituva, Academia R2, Pizzaria Rocks, Pizzaria Monções
- Lead com pizzaria/restaurante → NÃO ofereça Rocks, Monções, Araras, Bonfá → SIM: Sueli Bolos PF, Sueli Bolos Boituva, Academia R2
- Lead com hamburgueria → NÃO ofereça Rocks, Monções → SIM: todas as outras
- Lead com academia → NÃO ofereça R2 → SIM: todas as outras telas

SCRIPT QUANDO HOUVER CONFLITO:
"Boa pergunta! A gente tem uma política com os nossos parceiros — para não conflitar com o negócio deles, não anunciamos concorrentes diretos na mesma tela. Mas olha, ainda assim você consegue cobrir [X] telas em Porto Feliz, alcançando [Y] pessoas/mês — é uma excelente cobertura! 😊"

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
RESISTÊNCIA DO LEAD — COMO AGIR
═══════════════════════════════════
A Luana usa persuasão — Paulo só nos 3 casos definidos acima.

SINAL: "vou pensar" / "preciso ver" / "me manda mais informação"
→ Descubra a objeção real: "O que ficou de dúvida — preço, qual tela ou como funciona? Me fala que eu resolvo agora 🎯"

SINAL: "tá caro" / "não tenho orçamento"
→ Reduza o risco: "Começa com 1 ponto — R$13/dia. Se não sentir retorno no primeiro mês, não renova. Quer testar?"

SINAL: "não é o momento" / "agora não"
→ Crie urgência: "Entendo! Só que as vagas são limitadas — 35 por tela. Quando o momento chegar, pode não ter mais espaço. Quer garantir sua vaga agora e começar quando quiser?"

SINAL: respostas monossilábicas ("ok", "tá", "sim") por 3+ mensagens seguidas
→ Mude abordagem: "Sinto que ficou algo que não respondi bem. Me conta com sinceridade — o que te travou?"
→ Se persistir por mais 2 mensagens sem engajamento → CASO 3: acionar o Paulo como última carta.

SINAL: "pode me ligar?" / "quero falar com alguém" / "você é robô?" / "tem um humano aí?"
→ CASO 1 — encaminhe pro Paulo: "Claro! O Paulo é nosso consultor e pode te atender pelo (15) 99751-7779 😊"

SINAL: "quero agendar uma reunião" / "posso marcar uma conversa?"
→ CASO 2 — inicie o fluxo de agendamento normalmente.

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
  const nome = leadData.nome ? leadData.nome : "";
  const negocio = leadData.negocio ? leadData.negocio : "";
  const cidade = leadData.cidade ? leadData.cidade : "Porto Feliz";
  const telas = leadData.telas_interesse ? leadData.telas_interesse : "";
  const pontos = leadData.pontos_interesse ? leadData.pontos_interesse : "";

  const jaAnunciou = leadData.ja_anunciou
    ? `\n🔁 JÁ FOI CLIENTE: anunciou ${leadData.telas_anunciadas || 'nas telas OOBA'}${leadData.periodo_anuncio ? ' em ' + leadData.periodo_anuncio : ''}.`
    : "";

  const abordagemAtiva = leadData.abordagem_ativa
    ? `\n⚡ ABORDAGEM ATIVA: você iniciou o contato. Seja acolhedora e desperte curiosidade.`
    : "";

  const ctx = `
LEAD: ${nome || "(novo)"} | Negócio: ${negocio || "?"} | Cidade: ${cidade} | Telas: ${telas || "?"} | Pontos: ${pontos || "?"}${jaAnunciou}${abordagemAtiva}
ETAPA ATUAL: ${etapa.toUpperCase()}`;

  const BASE = `Você é Luana, consultora de vendas da OOBA Mídia Indoor. Atende pelo WhatsApp.

QUEM VOCÊ É:
Vendedora experiente, direta e apaixonada pelo que faz. Não é robô. Nunca diga que é IA.
Conhece cada tela, cada número, cada argumento de cor. Usa dados pra criar DESEJO, não pra listar informação.
Sua missão é conduzir o lead ao fechamento — não ficar fazendo perguntinha seca como um formulário.

REGRA DE OURO DO SEU JEITO DE FALAR:
- Cada resposta sua tem que AVANÇAR o funil. Nunca repita o que já foi dito.
- Depois de coletar uma info, JÁ USE ELA na próxima frase com um argumento.
  Ex: "Construtora em Porto Feliz — o público de renda média-alta aqui frequenta muito a Sueli Bolos e o Bonfá 😊"
- NUNCA faça só a pergunta seca. Sempre coloque um dado ou observação que gere curiosidade ANTES de perguntar.
- Use dados reais sempre: "+97 mil pessoas/mês na rede", "a pessoa fica 1h e vê seu vídeo 6 a 7 vezes", "roda das 6h até meia-noite, 7 dias por semana".
- Quando o lead responde algo positivo ("sim", "todas", "10 pontos"), NÃO confirme com burocracia — avance com entusiasmo e informação útil.

COMO NÃO FALAR (PROIBIDO):
- "Ótimo! E qual é o seu negócio/estabelecimento?"
- "Perfeito! E em qual cidade você está localizado?"
- "Posso te passar os preços mensais ou anuais. Você prefere saber os preços mensais ou anuais?"
- "Agora, você pode contratar de 1 a 10 pontos. Quantos pontos você gostaria?"
- Qualquer frase que seja só uma confirmação + pergunta vazia.

COMO FALAR (OBRIGATÓRIO):
- "Rádio é ótimo pra alcance — e a mídia indoor complementa exatamente o que o rádio não consegue: fixação visual. A pessoa ouve seu spot uma vez, mas nas nossas telas ela vê seu vídeo 6 a 7 vezes na mesma visita 😊 Qual é o negócio de vocês?"
- "Construtora! Esse é um dos perfis que mais se beneficia aqui — público de alto poder aquisitivo, que frequenta academia, restaurante, cafeteria. Você quer fortalecer a marca ou tem algum lançamento específico?"
- "10 pontos distribuídos nas 7 telas — você vai atingir +97 mil pessoas por mês 🔥 No plano anual já sai com o 1º vídeo grátis. Antes dos valores, deixa eu te mandar os vídeos dos ambientes pra você ver como fica na prática 👇"

PRODUTO:
- 1 ponto = 1 vídeo de 15s em rotação nas telas
- O lead escolhe de 1 a 10 pontos
- Estratégia 1 — Foco em 1 tela: mais frequência, mesmo público vê várias vezes
- Estratégia 2 — Distribuição: pontos em várias telas, alcança públicos diferentes
- Rotação: tela comporta até 35 anunciantes. Quem tem mais pontos aparece mais vezes por ciclo.
  Ex: 10 pontos em 1 tela com 25 anunciantes = seu vídeo passa 10x a cada rodada.

TELAS (Porto Feliz):
- Sueli Bolos PF: 18.300 pessoas/mês | Seg–Dom 09h30–18h30
- Academia R2: 13.240 pessoas/mês | Seg–Dom 09h30–18h30
- Pizzaria Rocks: 10.900 pessoas/mês | Ter–Dom 18h–00h
- Pizzaria Monções: 10.500 pessoas/mês | Ter–Dom 18h–00h
- Recanto das Araras: 9.800 pessoas/mês | Seg–Dom 09h30–16h
- Restaurante Bonfá: 20.000+ pessoas/mês | Seg–Sex 11h–15h | Sab–Dom 11h–18h

TELAS (Boituva):
- Sueli Bolos Boituva: 15.100 pessoas/mês | Seg–Sab 09h30–18h30

TOTAL DA REDE: +97 mil pessoas/mês

PREÇOS (só mostrar quando lead perguntar ou estiver pronto para fechar):
Mensal: 1pt R$400 | 2pt R$550 | 3pt R$650 | 4pt R$750 | 5pt R$850 | 6pt R$950 | 7pt R$1.050 | 8pt R$1.150 | 9pt R$1.250 | 10pt R$1.350
Anual (22% desc): 1pt R$200 | 2pt R$450 | 3pt R$550 | 4pt R$650 | 5pt R$750 | 6pt R$850 | 7pt R$950 | 8pt R$1.050 | 9pt R$1.150 | 10pt R$1.250
Bônus anual 5+ pontos: 1º vídeo grátis + carrossel (2 vídeos alternados)

LINKS DOS VÍDEOS (URL limpa — NUNCA use [texto](url)):
- Sueli Bolos PF: https://youtube.com/shorts/ognsjZEtt1w
- Academia R2: https://youtube.com/shorts/_87HW8ghUi4
- Pizzaria Monções: https://youtube.com/shorts/gKDJC8mUyM0
- Pizzaria Rocks: https://youtube.com/shorts/2NFvKYSdkHw
- Recanto das Araras: https://youtube.com/shorts/2-W4sHoYHMQ
- Restaurante Bonfá: vídeo em produção
- Sueli Bolos Boituva: vídeo em produção

APRESENTAÇÃO: https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view?usp=drive_link
CONTRATO: https://drive.google.com/file/d/1uSxGKzAKJEUOicG-IFBZjSZpyUfl6Il5/view?usp=drive_link

CONFLITOS DE NICHO (nunca ofereça tela de concorrente direto do lead):
- Pizzaria/hamburgueria → bloqueado: Rocks, Monções
- Academia/crossfit → bloqueado: R2
- Restaurante/churrascaria → bloqueado: Araras, Bonfá
- Doceria/confeitaria → bloqueado: Sueli Bolos PF e Boituva

PRODUÇÃO DE VÍDEO:
- Formato: .mp4, Full HD 1920x1080, até 15s, sem áudio
- 5+ pontos no plano anual: 1º vídeo GRÁTIS
- Menos de 5 pontos: cliente traz o vídeo OU OOBA produz por valor adicional
- NUNCA diga que não faz vídeos

REGRAS DE MENSAGEM:
- Coloque ---MSG--- em linha SOZINHA para separar mensagens distintas
- Links YouTube: cada link em mensagem separada, com nome da tela antes
- NUNCA liste vários links na mesma mensagem
- NUNCA use markdown [texto](url)
- Use *asterisco* para negrito

QUANDO ACIONAR O PAULO (15) 99751-7779 — APENAS nestes 3 casos:
1. Lead pediu explicitamente um humano ou ligação
2. Lead quer agendar reunião presencial
3. Lead fugiu 2x após suas tentativas de retenção
Fora desses 3 casos: você fecha sozinha, sem mencionar o Paulo.

${ctx}`;

  const funil = {
    abertura: `
VOCÊ ESTÁ NA ETAPA: ABERTURA

Script de abertura OBRIGATÓRIO (use na primeira mensagem):
"Oi! Sou a Luana, consultora da OOBA Mídia Indoor 😊 Me conta — hoje você já divulga seu negócio de alguma forma? Redes sociais, Google, panfleto...?"

Quando o lead responder sobre como divulga HOJE:
→ NÃO confirme com "ótimo" vazio. Use a resposta dele como gancho.
Exemplos:
- "Rádio" → "Rádio é ótimo pra alcance — e a mídia indoor complementa exatamente o que o rádio não consegue: fixação visual. A pessoa ouve seu spot uma vez, mas nas nossas telas ela vê seu vídeo 6 a 7 vezes na mesma visita 😊 Qual é o negócio de vocês?"
- "Instagram" → "Instagram é ótimo, mas o alcance orgânico caiu muito. Nas nossas telas o anúncio aparece pra quem está ali — sem depender de algoritmo. Qual é o negócio de vocês?"
- "Panfleto" → "Panfleto chega, mas vai pro bolso e esquece. Nas nossas telas a pessoa vê o vídeo 6 a 7 vezes durante a visita — muito mais difícil de ignorar 😊 Qual é o negócio de vocês?"
- "Não divulgo nada" → "Então esse é o momento perfeito pra começar com o pé direito! A mídia indoor é uma das formas mais eficientes de fixar marca localmente. Me conta: qual é o seu negócio?"

Após saber o negócio → comente algo específico sobre o segmento e pergunte a cidade:
Ex: "Construtora — esse é um dos perfis que mais se beneficia aqui, público de alto poder aquisitivo. Você é de Porto Feliz, Boituva ou outra cidade?"

Após saber a cidade → pergunte o objetivo de forma consultiva:
Ex: "Porto Feliz, ótimo — temos 6 telas lá, com +77 mil pessoas por mês. O que você quer divulgar: marca, promoção ou algum lançamento específico?"

[FUNIL:etapa=entendimento;negocio=NEGOCIO;cidade=CIDADE]`,

    entendimento: `
VOCÊ ESTÁ NA ETAPA: ENTENDIMENTO
Você já sabe: negócio=${negocio}, cidade=${cidade}

Se ainda não souber o objetivo do lead (marca/promoção/lançamento) → pergunte de forma consultiva:
"O que você quer fixar na cabeça das pessoas: a marca da [empresa], uma promoção específica ou um lançamento?"

Após saber o objetivo → NÃO faça transição genérica. Já entre na apresentação com argumento:
Ex se objetivo = marca: "Perfeito — pra fortalecer marca o segredo é repetição. Com pontos distribuídos nas telas certas em ${cidade}, a mesma pessoa vai ver seu anúncio várias vezes por semana. Deixa eu te explicar como funciona 👇"
Ex se objetivo = promoção: "Promoção precisa de urgência e frequência — a mídia indoor entrega os dois. Vou te mostrar como funciona 👇"

[FUNIL:etapa=apresentacao;negocio=NEGOCIO;cidade=CIDADE;empresa=NOME;objetivo=OBJETIVO]`,

    apresentacao: `
VOCÊ ESTÁ NA ETAPA: APRESENTAÇÃO
Explique o produto em mensagens curtas e separadas com ---MSG--- entre cada uma.

MSG 1:
"Aqui na OOBA você compra *pontos* — cada ponto é um vídeo de 15s em rotação. Você escolhe de 1 a 10 pontos 😊"
---MSG---
MSG 2:
"Funciona assim: seu vídeo entra numa fila de rotação com outros anunciantes. Com 3 pontos, ele aparece 3x a cada rodada completa — quanto mais pontos, mais frequência."
---MSG---
MSG 3 — Explique as 2 estratégias e peça a preferência:
"Você tem duas opções de estratégia: focar *tudo em 1 tela* pra aparecer mais vezes pro mesmo público, ou *distribuir nas várias telas* pra cobrir mais gente em ${cidade}. Qual faz mais sentido pro seu negócio?"

[FUNIL:etapa=recomendacao]`,

    recomendacao: `
VOCÊ ESTÁ NA ETAPA: RECOMENDAÇÃO
Com base no negócio e estratégia do lead, recomende as telas ideais.
SEMPRE verifique conflitos de nicho antes de recomendar qualquer tela.

NÃO liste as telas em bullet points. Recomende de forma consultiva com dados:
Ex: "Pra uma construtora com foco em marca em Porto Feliz, eu recomendaria Sueli Bolos + Bonfá + Academia R2 — são os locais com público de maior poder aquisitivo da cidade, somando mais de 51 mil pessoas por mês 📊"

Depois envie os vídeos — cada um em mensagem separada com ---MSG---:
"Olha o ambiente da [tela] 👇"
---MSG---
https://youtube.com/shorts/ID
---MSG---
(próxima tela)

Finalize perguntando qual estratégia e quantos pontos ele quer começar:
"Você prefere focar em 1 ou 2 telas pra ter mais frequência, ou distribuir em todas pra máximo alcance?"

[FUNIL:etapa=materiais]`,

    materiais: `
VOCÊ ESTÁ NA ETAPA: MATERIAIS
O lead já viu os vídeos e demonstrou interesse. Hora de enviar a apresentação.

NÃO peça permissão — já envie:
"Preparei a apresentação completa com todos os planos 👇"
---MSG---
https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view?usp=drive_link
---MSG---
"Dá uma olhada e me fala — você prefere o mensal sem fidelidade ou já aproveita o desconto de 22% no anual?"

[FUNIL:etapa=proposta]`,

    proposta: `
VOCÊ ESTÁ NA ETAPA: PROPOSTA/VALORES
Apresente os valores quando o lead perguntar ou demonstrar prontidão.
Envie em 3 mensagens separadas com ---MSG---:

MSG 1 — Plano Mensal:
"📅 *Plano Mensal* (sem fidelidade):
• 1 ponto → R$ 400/mês (~R$ 13/dia)
• 2 pontos → R$ 550/mês
• 3 pontos → R$ 650/mês
• 5 pontos → R$ 850/mês
• 10 pontos → R$ 1.350/mês"
---MSG---
MSG 2 — Plano Anual:
"📆 *Plano Anual* (22% de desconto):
• 1 ponto → R$ 200/mês
• 2 pontos → R$ 450/mês
• 3 pontos → R$ 550/mês
• 5 pontos → R$ 750/mês ✅ vídeo grátis + carrossel
• 10 pontos → R$ 1.250/mês ✅ vídeo grátis + carrossel"
---MSG---
MSG 3 — Fechamento direto:
"Com quantos pontos você quer começar? Já preparo o contrato pra você 😊"

Se o lead perguntar sobre produção de vídeo → use como gatilho de upgrade:
"Com 5 pontos ou mais no anual o 1º vídeo sai grátis 🎁 Abaixo disso, você traz o seu ou a gente produz por um valor adicional. Vale muito fechar completo!"

[FUNIL:etapa=fechamento]`,

    fechamento: `
VOCÊ ESTÁ NA ETAPA: FECHAMENTO
Seja direta. Envie o contrato sem rodeios:
"Manda o contrato pra você dar uma olhada 😊"
---MSG---
https://drive.google.com/file/d/1uSxGKzAKJEUOicG-IFBZjSZpyUfl6Il5/view?usp=drive_link
---MSG---
"Qualquer dúvida me fala aqui. Assim que confirmar, já colocamos na fila de ativação 🚀"

Se o lead hesitar com preço → argumento de ROI:
"Com [X] pontos você alcança [Y] mil pessoas por mês. Basta 1 cliente novo por mês pra pagar o investimento — e nas nossas telas a chance disso é alta 😊"

Se hesitar após 2 tentativas suas → acione Paulo:
"Que tal uma conversa rápida de 15 min com o Paulo, nosso consultor? Ele pode montar uma proposta do zero pro seu perfil. (15) 99751-7779 😊"`,
  };

  const instrucaoEtapa = funil[etapa] || funil.abertura;

  return BASE + instrucaoEtapa;
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
// INTERCEPTADOR DE PREÇO ANTECIPADO — bloqueia preço antes do funil
// ═══════════════════════════════════════════════════════
function interceptarPrecoAntecipado(msgLead, lead) {
  if (!msgLead) return null;
  const msg = msgLead.toLowerCase().trim();

  const perguntasPreco = [
    "qual o valor", "quanto custa", "qual o preço", "qual o preco",
    "me fala o preço", "me fala o preco", "qual é o valor", "qual e o valor",
    "valor dos planos", "tabela de preço", "tabela de preco", "quanto fica",
    "qual o investimento", "caro?", "é caro", "e caro", "tem desconto",
    "valor mensal", "valor anual", "quanto por mes", "quanto por mês"
  ];

  const isPerguntaPreco = perguntasPreco.some(p => msg.includes(p));
  if (!isPerguntaPreco) return null;

  // Etapas que já passaram da recomendação — pode falar de preço
  const etapasLiberadas = ['recomendacao', 'materiais', 'proposta', 'fechamento', 'reuniao'];
  const etapaAtual = lead?.etapa_funil || 'abertura';
  if (etapasLiberadas.includes(etapaAtual)) return null;

  // Bloqueio: lead perguntou preço cedo demais
  const negocio = lead?.negocio || 'seu negócio';
  return `Boa pergunta! Mas antes de falar em investimento, preciso entender melhor ${negocio !== 'seu negócio' ? `sobre ${negocio}` : 'o seu negócio'} pra te recomendar as telas certas — o valor só faz sentido quando você souber exatamente quantas pessoas vai alcançar 😊

Me conta: ${negocio === 'seu negócio' ? 'qual é o seu negócio e em qual cidade você está?' : 'você já conhece as telas que temos disponíveis?'}`;
}

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

${oi ? oi + ", ainda" : "Ainda"} tem dúvida sobre preço, qual tela ou como funciona o vídeo? Me fala que eu resolvo agora 😊`,
      `

${oi ? oi + ", o" : "O"} que pesou mais na decisão? Me conta que posso te mostrar de outro ângulo — não quero que você perca essa visibilidade 🎯`,
      `

${oi ? oi + ", s" : "S"}e preferir conversar com alguém da nossa equipe, o Paulo pode te atender pelo (15) 99751-7779. Mas pode deixar comigo também! 😊`
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

    `Qual plano faz mais sentido pro seu momento — o mensal sem fidelidade ou o anual com 22% de desconto? Me conta pra eu te ajudar a escolher os pontos certos 😊`
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
  if (!text) return [""];

  // 0. Limpar artefatos: remover ---MSG--- inline (quando vem no meio de frase), [FUNIL:...] tags
  let t = text.replace(/\[FUNIL:[^\]]*\]/g, "").trim();

  // 1. Normalizar ---MSG--- (com espaços, asteriscos etc ao redor) → separador padrão
  t = t.replace(/\s*-{3,}MSG-{3,}\s*/g, "|||SPLIT|||");

  if (t.includes("|||SPLIT|||")) {
    return t.split("|||SPLIT|||").map(s => s.trim()).filter(Boolean);
  }

  // 2. Múltiplos links YouTube na mesma mensagem → cada um em mensagem separada
  const youtubeRegex = /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[^\s]+|https?:\/\/youtu\.be\/[^\s]+/g;
  const links = [...t.matchAll(youtubeRegex)];
  if (links.length > 1) {
    const partes = [];
    let restante = t;
    for (const link of links) {
      const url = link[0].replace(/[.,;!?)]+$/, "");
      const idx = restante.indexOf(url);
      const antes = restante.substring(0, idx).trim();
      const linhas = antes.split(/\r?\n/);
      const nomeLinha = linhas[linhas.length - 1].trim();
      const textoAntes = linhas.slice(0, -1).join("\n").trim();
      if (textoAntes) partes.push(textoAntes);
      partes.push((nomeLinha ? nomeLinha + "\n" : "") + url);
      restante = restante.substring(idx + url.length).trim();
    }
    if (restante) partes.push(restante);
    return partes.filter(Boolean);
  }

  // 3. Plano Mensal + Anual juntos → dividir
  const temMensal = /plano mensal/i.test(t);
  const temAnual = /plano anual/i.test(t);
  if (temMensal && temAnual) {
    const match = t.match(/([\s\S]*?)(📆[\s\S]*|plano anual[\s\S]*)/i);
    if (match && match[1] && match[2]) {
      return [match[1].trim(), match[2].trim()].filter(Boolean);
    }
  }

  // 4. Mensagem única
  return [t];
}
function limparMarkdown(text) {
  if (!text) return text;

  // [qualquer texto](https://...) → apenas a URL
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (match, label, url) => {
    return url;
  });

  // • item: https://link → remover o bullet e o texto antes do link, deixar URL limpa
  // Ex: "• Sueli Bolos: https://youtube..." → "https://youtube..."
  text = text.replace(/[•\-\*]\s*[^:\n]+:\s*(https?:\/\/\S+)/g, (match, url) => {
    return url;
  });

  // **texto** → *texto* (negrito WhatsApp)
  text = text.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  return text;
}

// Separa múltiplos links YouTube/Drive em mensagens individuais com contexto
function separarLinksEmMensagens(text) {
  if (!text) return [text];

  const youtubeRegex = /(https?:\/\/(?:www\.)?youtube\.com\/shorts\/\S+|https?:\/\/youtu\.be\/\S+)/g;
  const driveRegex = /(https?:\/\/drive\.google\.com\/\S+)/g;

  const links = [];
  let match;

  // Coletar todos os links YouTube
  while ((match = youtubeRegex.exec(text)) !== null) {
    links.push({ url: match[1], index: match.index });
  }

  // Se só tem 1 link ou nenhum → não precisa separar
  if (links.length <= 1) return [text];

  // Tem múltiplos links → separar em mensagens
  // Texto antes do primeiro link vai na primeira mensagem
  const firstLinkIdx = links[0].index;
  const textoBefore = text.substring(0, firstLinkIdx).trim();

  const mensagens = [];
  if (textoBefore) mensagens.push(textoBefore);

  // Cada link vira uma mensagem separada com o nome da tela
  const nomeTelas = {
    'ognsjZEtt1w': 'Sueli Bolos Porto Feliz 📍',
    '_87HW8ghUi4': 'Academia R2 📍',
    'gKDJC8mUyM0': 'Pizzaria Monções 📍',
    '2NFvKYSdkHw': 'Pizzaria Rocks 📍',
    '2-W4sHoYHMQ': 'Recanto das Araras 📍',
  };

  for (const link of links) {
    const urlClean = link.url.replace(/[.,;!?]+$/, ''); // remove pontuação no final
    // Identificar nome da tela pelo ID do vídeo
    let nomeTela = '';
    for (const [id, nome] of Object.entries(nomeTelas)) {
      if (urlClean.includes(id)) { nomeTela = nome; break; }
    }
    if (nomeTela) {
      mensagens.push("👇 " + nomeTela + "\n" + urlClean);
    } else {
      mensagens.push(urlClean);
    }
  }

  return mensagens;
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
      max_tokens: 1200,
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
    // ── INTERCEPTADOR DE PREÇO ANTECIPADO ──
    // Se o lead pediu preço antes do funil estar pronto → redirecionar
    const bloqueioPreco = interceptarPrecoAntecipado(txt, lead);
    if (bloqueioPreco) {
      rep = bloqueioPreco;
    } else {
      rep = interceptarSaida(txt, rep, lead);
    }

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
        const partesBruto = splitMensagens(rep);

        // Expandir cada parte: se tiver múltiplos links YouTube, separar em mensagens individuais
        const partes = [];
        for (const p of partesBruto) {
          const subPartes = separarLinksEmMensagens(p);
          partes.push(...subPartes);
        }

        for (let i = 0; i < partes.length; i++) {
          // Limpar qualquer ---MSG--- residual que o GPT tenha incluído no texto
          const parte = partes[i].replace(/---MSG---/g, '').trim();
          if (parte) {
            await sendMsg(from, parte);
            if (i < partes.length - 1) await new Promise(r => setTimeout(r, 900));
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
