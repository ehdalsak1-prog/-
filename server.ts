import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';

// Allow up to 35MB payload for high-resolution mobile camera delivery slips & receipts
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

app.post('/api/parse-slip', async (req, res) => {
  try {
    const { imageBase64, mimeType, rawText } = req.body;

    if (!imageBase64 && !rawText) {
      return res.status(400).json({
        success: false,
        error: '분석할 전표(납품증, 거래명세서 등) 이미지 또는 텍스트를 제공해주세요.',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error:
          'GEMINI_API_KEY가 서버 환경에 설정되지 않았습니다. AI Studio의 Settings > Secrets를 확인해주세요.',
      });
    }

    const contentsParts: any[] = [];

    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      contentsParts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: cleanBase64,
        },
      });
    }

    const systemPrompt = `당신은 대한민국 산업 및 건설 현장 자재 관리 전문 AI입니다.
사용자가 제공한 전표(납품증, 납품서, 납품확인서, 거래명세표, 거래명세서, 세금계산서, 입고전표, 출하전표 등)를 정밀 분석하여 자재 반입 대장에 바로 등록할 수 있는 정형화된 JSON 데이터를 추출하세요.

[정밀 추출 지침]
1. documentType: 전표 유형을 한국어로 정확히 명시 (예: '거래명세서', '납품증', '납품확인서', '입고전표', '세금계산서', '출하전표', '기타').
2. supplierName: 공급자(공급처, 발주처, 구매처, 상호) 란의 회사명을 추출 (예: '대원강업', '현대제철', '삼우테크' 등). '(주)' 등은 포함해도 좋으며, 대장의 구매처 필드에 자동 입력됩니다.
3. documentDate: 전표 작성일자, 납품일자, 또는 거래일자를 반드시 'YYYY-MM-DD' 형식으로 정규화 (예: '2026-11-04'). 연도가 2자리로 표기된 경우(예: '26.11.04') 2026년으로 보정.
4. receiverName: 공급받는자 / 납품처 (예: '(주)다인', '용인사업부', '고안리공장' 등).
5. totalAmount: 전표의 총 공급가액 또는 합계금액 (숫자, 쉼표 제거).
6. notes: 전표 상·하단 비고, 배송지(예: 고안리 공장), 차량번호, 운송기사명 등 특이사항.
7. items: 표에 기재된 모든 자재 품목 행을 순서대로 빠짐없이 추출:
   - name: 자재 품목명 (품명).
   - spec: 규격 및 사양 (치수, 두께, 재질, 모델명 등). 없거나 비어있으면 '-'로 설정.
   - quantity: 반입/납품 수량 (0보다 큰 숫자).
   - unit: 단위 (예: '파레트', 'EA', 'BOX', '개', '대', 'set', '본', 'kg', 'm', '롤' 등). 전표에 적힌 단위 유지 (단위가 없으면 'EA').
   - packQty: '1파레트 = 630 EA' 또는 '1BOX = 50개' 등 단위당 입수량 환산 정보가 있을 때 해당 숫자 (예: 630). 없으면 생략.
   - subUnit: 입수량 환산 낱개 단위 (예: 'EA', '개'). 없으면 생략.
   - unitPrice: 단가 (숫자, 없으면 0).
   - amount: 공급가액 또는 금액 (숫자, 없으면 0).
   - remarks: 품목별 비고란 내용 (로트번호, 특이사항 등).

${rawText ? `[사용자 입력 추가 텍스트 또는 전표 내용]\n${rawText}` : ''}`;

    contentsParts.push({ text: systemPrompt });

    const schemaConfig = {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: {
            type: Type.STRING,
            description: '전표 종류 (예: 거래명세서, 납품증, 납품확인서, 세금계산서, 입고전표)',
          },
          supplierName: {
            type: Type.STRING,
            description: '공급자 / 구매처 상호명',
          },
          documentDate: {
            type: Type.STRING,
            description: '전표 일자 (YYYY-MM-DD)',
          },
          receiverName: {
            type: Type.STRING,
            description: '공급받는자 / 납품처',
          },
          totalAmount: {
            type: Type.NUMBER,
            description: '합계금액 (숫자)',
          },
          notes: {
            type: Type.STRING,
            description: '전표 비고 및 메모 (차량번호, 배송지 등)',
          },
          items: {
            type: Type.ARRAY,
            description: '전표에 포함된 자재 품목 목록',
            items: {
              type: Type.OBJECT,
              properties: {
                name: {
                  type: Type.STRING,
                  description: '자재 품목명',
                },
                spec: {
                  type: Type.STRING,
                  description: '규격 또는 사양 (없으면 -)',
                },
                quantity: {
                  type: Type.NUMBER,
                  description: '반입 수량 (숫자)',
                },
                unit: {
                  type: Type.STRING,
                  description: '단위 (예: 파레트, EA, BOX, 개, 대, set, 본, kg, m)',
                },
                packQty: {
                  type: Type.NUMBER,
                  description: '단위당 입수량 (선택)',
                },
                subUnit: {
                  type: Type.STRING,
                  description: '환산 낱개 단위 (선택, 예: EA)',
                },
                unitPrice: {
                  type: Type.NUMBER,
                  description: '단가 (선택, 숫자)',
                },
                amount: {
                  type: Type.NUMBER,
                  description: '금액 (선택, 숫자)',
                },
                remarks: {
                  type: Type.STRING,
                  description: '비고 메모',
                },
              },
              required: ['name', 'quantity', 'unit'],
            },
          },
        },
        required: ['items'],
      },
    };

    // Retry and fallback mechanism for transient 503 or 429 surges
    const modelsToTry = ['gemini-3.8-flash', 'gemini-flash-latest'];
    let lastError: any = null;
    let response: any = null;

    for (const model of modelsToTry) {
      let attempts = 0;
      while (attempts < 2) {
        try {
          response = await ai.models.generateContent({
            model,
            contents: { parts: contentsParts },
            config: schemaConfig,
          });
          break;
        } catch (err: any) {
          lastError = err;
          const isTransient =
            err?.message?.includes('503') ||
            err?.message?.includes('429') ||
            err?.status === 503 ||
            err?.status === 429;
          if (isTransient && attempts < 1) {
            attempts++;
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          break;
        }
      }
      if (response) break;
    }

    if (!response) {
      throw lastError || new Error('전표 분석에 실패했습니다.');
    }

    const rawJson = response.text || '{}';
    const parsedData = JSON.parse(rawJson);

    return res.json({
      success: true,
      data: parsedData,
    });
  } catch (error: any) {
    console.error('Error parsing receipt slip with Gemini:', error);
    const rawMsg = error?.message || '';
    let friendly = rawMsg;
    if (rawMsg.includes('503') || rawMsg.includes('high demand')) {
      friendly = 'AI 분석 서버에 일시적인 트래픽이 발생했습니다. 1~2초 후 다시 시도해주시면 정상 처리됩니다.';
    } else if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
      friendly = 'API 요청 한도에 일시 도달했습니다. 잠시 후 다시 시도해주세요.';
    } else if (rawMsg.includes('API_KEY')) {
      friendly = 'GEMINI_API_KEY가 올바르지 않거나 권한이 없습니다. Settings > Secrets를 확인해주세요.';
    }
    return res.status(500).json({
      success: false,
      error: friendly || '전표 분석 중 오류가 발생했습니다.',
    });
  }
});

// Multi-turn Gemini AI Chatbot endpoint for construction & material management assistance
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, systemInstruction, model = 'gemini-3.1-flash-lite', contextData } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: '대화 내용(messages)을 전달해주세요.',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY가 서버 환경에 설정되지 않았습니다. AI Studio의 Settings > Secrets를 확인해주세요.',
      });
    }

    // Sanitize and format messages for @google/genai SDK
    // SDK expects role to be 'user' or 'model', parts with text
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const msg of messages) {
      const rawRole = (msg.role || '').toLowerCase();
      const role: 'user' | 'model' = rawRole === 'model' || rawRole === 'assistant' ? 'model' : 'user';
      const text = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (!text) continue;

      // Avoid adjacent identical roles by merging if necessary
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += '\n\n' + text;
      } else {
        contents.push({
          role,
          parts: [{ text }],
        });
      }
    }

    // Ensure the conversation starts with a user turn
    while (contents.length > 0 && contents[0].role !== 'user') {
      contents.shift();
    }

    if (contents.length === 0) {
      return res.status(400).json({
        success: false,
        error: '유효한 사용자 메시지가 없습니다.',
      });
    }

    // Model selection: default to gemini-3.1-flash-lite for ultra-fast instant responses
    let selectedModel = 'gemini-3.1-flash-lite';
    if (model === 'gemini-3.8-flash' || model === 'gemini-4-argon' || model === 'gemini-3.1-flash-lite') {
      selectedModel = model;
    }

    const defaultRoleInstruction =
      '당신은 대한민국 산업 및 건설 현장의 자재 관리 전문 AI 어시스턴트 "다인 현장 자재 매니저"입니다. ' +
      '현장 자재 입고/반입 검수 기준, KS 규격, 수량 산출, 자재 보관 및 적재 안전 지침, 거래명세서/납품증 확인, ' +
      '대장 관리 팁에 대해 실무적이고 신속·명확하게 한국어로 친절하게 답변해주세요.';

    const fullSystemInstruction = `${systemInstruction ? systemInstruction.trim() : defaultRoleInstruction}${
      contextData ? `\n\n[현재 사용자의 현장 자재 대장 데이터 현황]:\n${contextData}` : ''
    }\n\n[답변 지침]: 핵심을 먼저 간결하고 신속하게 정리하고 필요시 번호나 글머리 기호(- )를 사용하여 가독성 있게 작성해주세요.`;

    // Attempt generation with retry/fallback
    let response: any = null;
    let lastError: any = null;

    const modelsToAttempt = [selectedModel];
    if (selectedModel !== 'gemini-3.1-flash-lite') {
      modelsToAttempt.push('gemini-3.1-flash-lite');
    }
    modelsToAttempt.push('gemini-3.8-flash');
    modelsToAttempt.push('gemini-flash-latest');

    for (const targetModel of modelsToAttempt) {
      let attempts = 0;
      while (attempts < 2) {
        try {
          response = await ai.models.generateContent({
            model: targetModel,
            contents,
            config: {
              systemInstruction: fullSystemInstruction,
            },
          });
          break;
        } catch (err: any) {
          lastError = err;
          const isTransient =
            err?.message?.includes('503') ||
            err?.message?.includes('429') ||
            err?.status === 503 ||
            err?.status === 429;
          if (isTransient && attempts < 1) {
            attempts++;
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          break;
        }
      }
      if (response && response.text) break;
    }

    if (!response || !response.text) {
      throw lastError || new Error('AI 모델 응답을 생성하지 못했습니다.');
    }

    return res.json({
      success: true,
      reply: response.text,
      modelUsed: selectedModel,
    });
  } catch (error: any) {
    console.error('Error generating chat response with Gemini:', error);
    const rawMsg = error?.message || '';
    let friendly = rawMsg;
    if (rawMsg.includes('503') || rawMsg.includes('high demand')) {
      friendly = 'AI 응답 서버에 일시적인 트래픽이 발생했습니다. 잠시 후 다시 질문해주세요.';
    } else if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
      friendly = 'API 사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요.';
    } else if (rawMsg.includes('API_KEY')) {
      friendly = 'GEMINI_API_KEY가 올바르지 않거나 권한이 없습니다. Settings > Secrets를 확인해주세요.';
    }
    return res.status(500).json({
      success: false,
      error: friendly || 'AI 대화 중 오류가 발생했습니다.',
    });
  }
});


// Mount Vite in development or static files in production
if (!isProd) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
