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

═══════════════════════════════════
GLOSSÁRIO OOBA — FUNDAMENTAL
═══════════════════════════════════
- TELA = o local físico (ex: Sueli Bolos, Pizzaria Rocks)
- PONTO = 1 vídeo de 15 segundos exibido nas telas. O cliente compra "pontos", não telas.
- Sempre que mencionar "pontos" pela primeira vez, explique automaticamente a diferença sem esperar o lead perguntar.
  Exemplo: "Aqui na OOBA a gente trabalha com pontos — cada ponto é um vídeo de 15 segundos nas nossas telas (os locais físicos). Você compra pontos, e a gente distribui nas telas que fazem mais sentido pro seu negócio."

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

CARROSSEL (a partir de 5 pontos):
- 2 vídeos em rotação sem custo adicional (institucional + promocional)
- O sistema alterna automaticamente — mesma pessoa vê a marca hoje e a promoção amanhã
- Argumento: "É como ter duas campanhas pelo preço de uma!"

═══════════════════════════════════
VÍDEOS DAS TELAS (usar SEMPRE YouTube Shorts — NUNCA Google Drive)
═══════════════════════════════════
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
SUA MISSÃO AGORA — ETAPA: ABERTURA
═══════════════════════════════════
O lead acabou de entrar em contato. Seu objetivo:
1. Se apresente como Luana, consultora da OOBA Mídia Indoor
2. Pergunte: "Hoje quais tipos de marketing você utiliza?"
3. Ouça e valide o que ele usa — nunca deprecie
4. Apresente a mídia indoor como complemento natural ao que ele já faz
5. Após entender o marketing atual, avance para descobrir o negócio dele

MARCADOR OBRIGATÓRIO: Ao identificar o negócio ou cidade do lead, inclua na sua resposta (invisível ao lead):
[FUNIL:etapa=entendimento;nome=NOME_SE_SOUBER;negocio=NEGOCIO_SE_SOUBER;cidade=CIDADE_SE_SOUBER]`,

    entendimento: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: ENTENDIMENTO
═══════════════════════════════════
Você já sabe que o lead tem interesse. Agora descubra:
1. Qual é o negócio dele exatamente?
2. Para qual público ele vende?
3. Ele fica em Porto Feliz, Boituva ou outra cidade?
4. O que ele quer divulgar — marca, produto ou promoção?

Faça isso de forma natural, como uma conversa, não como formulário.
Quando tiver as respostas, avance para apresentar como a OOBA funciona.

MARCADOR OBRIGATÓRIO quando avançar:
[FUNIL:etapa=apresentacao;negocio=NEGOCIO;cidade=CIDADE]`,

    apresentacao: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: APRESENTAÇÃO
═══════════════════════════════════
Você já conhece o negócio e a cidade do lead. Agora explique como a OOBA funciona:
1. Explique o conceito de PONTOS e TELAS (antecipe antes de ser perguntado)
2. Destaque: exposição de 6-7x para a mesma pessoa, 1h de permanência no local, 6h até meia-noite
3. Compare com outdoor: "Outdoor é alcance rápido. Indoor é fixação e repetição."
4. Fale sobre automação, relatórios e diferenciais
5. Conduza para a recomendação das telas ideais para o perfil dele

MARCADOR OBRIGATÓRIO quando avançar:
[FUNIL:etapa=recomendacao]`,

    recomendacao: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: RECOMENDAÇÃO
═══════════════════════════════════
Recomende as telas IDEAIS para o perfil deste lead com base no negócio e cidade dele.
1. Mostre 2-3 telas mais adequadas ao perfil com dados de fluxo
2. Explique POR QUE cada tela faz sentido para o negócio dele
3. Envie os links do YouTube Shorts das telas recomendadas
4. Sugira quantidade de pontos adequada ao perfil
5. Se for Porto Feliz, mencione a estratégia de cobertura total (manhã + noite)

Após enviar os vídeos, avance para materiais institucionais.

MARCADOR OBRIGATÓRIO quando avançar:
[FUNIL:etapa=materiais;telas_interesse=TELAS_ESCOLHIDAS;pontos_interesse=PONTOS_SUGERIDOS]`,

    materiais: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: MATERIAIS
═══════════════════════════════════
O lead já viu as telas. Agora envie os materiais institucionais:
1. Envie a apresentação: https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view?usp=drive_link
2. Envie o contrato: https://drive.google.com/file/d/1uSxGKzAKJEUOicG-IFBZjSZpyUfl6Il5/view?usp=drive_link
3. Diga: "Dá uma olhada com calma — qualquer dúvida pode me perguntar aqui mesmo!"
4. Aguarde o lead ler e voltar. Quando voltar, avance para a proposta.

MARCADOR OBRIGATÓRIO quando avançar para valores:
[FUNIL:etapa=proposta]`,

    proposta: `

═══════════════════════════════════
SUA MISSÃO AGORA — ETAPA: PROPOSTA
═══════════════════════════════════
AGORA é a hora de apresentar os valores. O lead já conhece tudo — é hora de fechar!
1. Apresente o plano recomendado com base no que ele demonstrou interesse
2. Destaque o plano anual (22% de desconto) e os bônus
3. Mostre o custo diário para tornar o valor tangível (ex: "R$400/mês = R$13/dia, menos que um café")
4. Use o gatilho do carrossel se ele tiver interesse em 5+ pontos
5. Conduza para o fechamento

MARCADOR OBRIGATÓRIO quando ele demonstrar interesse real:
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
      if (!m || (m.type !== "text" && m.type !== "audio" && m.type !== "voice")) return res.json({ ok: true });

      const msgId = m.id;
      console.log("MsgId recebido:", msgId);
      // Deduplicação via banco (mais confiável que memória em serverless)
      if (processedMsgs.has(msgId)) { 
        console.log("Duplicata (memória):", msgId); 
        return res.json({ ok: true }); 
      }
      processedMsgs.add(msgId);
      if (processedMsgs.size > 200) processedMsgs.delete(processedMsgs.values().next().value);

      // ── Responder ao Meta IMEDIATAMENTE (exigência: < 5s) ──
      // O processamento continua em background via Promise separada
      res.json({ ok: true });

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
          return // resposta ja enviada;
        }
      }

      if (!from || !txt) return // resposta ja enviada;

      console.log(`IN [${from}] etapa=? : ${txt}`);
      client = await getDB();
      await initDB(client);

      const rep = await replyAI(client, txt, from);
      if (rep) {
        console.log(`OUT [${from}]: ${rep.substring(0, 120)}...`);
        await sendMsg(from, rep);

        // ── ÁUDIO: Luana manda voice note 1 em cada 3 msgs ──
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
      }
      // resposta já enviada antecipadamente
    } catch(e) {
      console.error("ERR:", e.message);
      // resposta já enviada, só logar o erro
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  return res.status(405).json({ error: "method not allowed" });
};
